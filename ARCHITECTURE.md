# Architecture

This document describes the high-level architecture of GenieACS. If you want to
familiarize yourself with the codebase, you are in the right place.

## Bird's Eye View

GenieACS is a TR-069 Auto Configuration Server (ACS). It manages CPE devices
(routers, modems, gateways) using the CWMP protocol (TR-069). The system
consists of four network-facing services that share a MongoDB database:

```
                  +------------+
  CPE Devices --->| CWMP (7547)|-+
                  +------------+ |
                  +-----------+  |     +---------+
  CPE Devices --->| FS (7567) |--+---->| MongoDB |
                  +-----------+  |     +---------+
                  +-----------+  |
  OSS / Scripts ->| NBI (7557)|--+
                  +-----------+  |
                  +-----------+  |
  Administrators->| UI (3000) |--+
                  +-----------+
```

- **CWMP** -- The core TR-069 protocol server. CPE devices connect here to
  report their state and receive configuration instructions via SOAP/XML over
  HTTP.
- **NBI** -- Northbound Interface. A REST API for external systems (OSS/BSS,
  scripts, automation) to manage devices, tasks, presets, and configuration
  programmatically.
- **FS** -- File Server. Serves firmware images and configuration files to CPE
  devices during download operations.
- **UI** -- Web interface. A Koa-based backend serving a Mithril.js single-page
  application for administrators to browse devices, manage configuration, and
  trigger operations.

All four services follow the same process model: a primary process forks
configurable worker processes via Node.js `cluster` (see `cluster.ts`). Workers
connect to MongoDB and start an HTTP(S) server.

## Code Map

```
bin/                        Service entry points (5 executables)
lib/                        All backend logic
  common/                   Shared utilities (expression engine, Path, errors)
    expression.ts           Expression class hierarchy (base + subclasses)
    expression/             Expression parser, evaluator, normalizer, minimizer
  cwmp/                     CWMP-service-specific DB and caching
  db/                       Database layer (MongoDB collections, query synthesis)
  ui/                       UI-service-specific API, DB, and caching
  types/                    (empty, reserved)
ui/                         Frontend SPA (Mithril.js)
  components/               Reusable UI components (parameter, tags, ping, etc.)
  css/                      Stylesheets (vanilla CSS)
  icons/                    SVG icons (compiled into a sprite)
test/                       Unit tests (Node.js native test runner)
build/                      Build scripts (esbuild-based)
public/                     Static assets (logo, favicon)
```

### Entry Points (`bin/`)

Each file in `bin/` bootstraps one service. They are structurally identical:
initialize logging, read config, fork workers in the primary process, connect to
MongoDB and start the HTTP server in each worker.

- `genieacs-cwmp.ts` -- CWMP service. Unique in that it disables HTTP keep-alive
  (`keepAliveTimeout: 0`) and provides custom `onConnection` / `onClientError`
  hooks for TR-069 session lifecycle management.
- `genieacs-nbi.ts` -- NBI service. Straightforward REST API server.
- `genieacs-fs.ts` -- File server. The leanest service; does not use the
  extensions subsystem.
- `genieacs-ui.ts` -- UI service. Wraps the Koa application as the HTTP
  listener.
- `genieacs-ext.ts` -- **Not a service.** This is a child process worker spawned
  by the extensions subsystem. It communicates with its parent via IPC,
  executing user-defined extension scripts in isolation.

### The Expression System (`lib/common/expression.ts`, `lib/common/expression/`)

The `Expression` class (defined in `lib/common/expression.ts`) is the most
important abstraction in the codebase. It uses a typed class hierarchy:
`Expression.Literal` (wraps `string | number | boolean | null`),
`Expression.Parameter` (wraps a `Path`), `Expression.Binary` (operator +
left/right), `Expression.Unary` (operator + operand), `Expression.FunctionCall`
(name + args), and `Expression.Conditional` (condition/then/otherwise). For
example, in the SQL-like text syntax:

```
Device.ModelName = "BrandX" AND Events.Inform > 1000
```

Expressions are used pervasively:

- **Query/filter language** -- Database queries for devices, faults, presets,
  etc. are all represented as expressions and compiled to MongoDB filters.
- **Configuration values** -- Config entries and preset preconditions are
  expressions, enabling dynamic evaluation.
- **Authorization** -- Permission filters and validators are expressions.
- **Pagination cursors** -- Keyset pagination boundaries are expressed as filter
  expressions.

The expression pipeline flows through four modules:

1. `parser.ts` -- Parses a SQL-like text syntax into the AST using a hand-rolled
   recursive descent parser with a `Cursor`-based scanner. Also provides
   `stringifyExpression()` for serialization. The `map()` / `mapAsync()`
   tree-walking primitives are abstract methods on the `Expression` class, and
   `stringify()` is now `Expression.toString()`.
2. `normalize.ts` -- Algebraic normalization using exact rational polynomial
   arithmetic over native `bigint` values. The `Polynomial` class extends
   `Expression` as an intermediate representation. Ensures equivalent
   expressions have the same canonical form (e.g., `a + 2 > b` and `a > b - 2`
   normalize identically).
3. `synth.ts` -- Boolean logic minimization via the Espresso algorithm
   (espresso-iisojs). Converts expressions to minimal sum-of-products form with
   three-valued logic (true/false/null). Handles domain-specific constraints
   like comparison ordering and LIKE pattern relationships.
4. `evaluate.ts` -- Runtime evaluation. The `reduce()` function evaluates
   operators on literal values and supports partial evaluation (returns a
   reduced expression if some values are unknown). Parameter resolution is
   handled by the `Expression.evaluate()` method (in `lib/common/expression.ts`)
   which calls `reduce()` after mapping children via a user-supplied callback.

`pagination.ts` implements cursor-based pagination by generating filter
expressions from sort-key bookmarks.

### The Path System (`lib/common/path.ts`, `lib/common/path-set.ts`)

`Path` represents a TR-069 parameter path (e.g., `Device.WiFi.SSID.1.Name`).
Paths can contain wildcards (`*`) and alias expressions (`[key:value]`) for
query-based addressing.

Key design decisions:

- **Cached** -- `Path.parse()` caches instances in a two-generation LRU cache
  rotated every 120 seconds. The constructor is public (used directly by the
  parser and by methods like `slice()`, `concat()`, and `stripAlias()`).
- **Bitmask encoding** -- The `wildcard` and `alias` fields are bitfields for
  O(1) segment-type checking. This limits paths to 32 segments. A `colon` field
  tracks the number of attribute path segments (after a `:` separator), enabling
  `paramLength` and `attrLength` accessors.
- **Immutable** -- Segment arrays are `Object.freeze()`-d.

`PathSet` is a multi-indexed collection of paths supporting pattern-matching
queries. It maintains separate `paramSegmentIndex` and `attrSegmentIndex` arrays
(one `Map<string, Set<Path>>` per position), plus a `stringIndex` map. The
`find()` method takes bitmasks to control which segments require exact matches
vs. wildcard compatibility, then uses set intersection across the smallest index
sets. A higher-level `findCompat()` method computes the appropriate bitmasks for
superset/subset matching.

### CWMP Protocol Layer (`lib/cwmp.ts`, `lib/soap.ts`, `lib/xml-parser.ts`)

`xml-parser.ts` is a custom single-pass XML parser (no DOM). It scans
character-by-character with bitwise state flags, building a tree of elements
with namespace support. Does not support CDATA.

`soap.ts` handles both parsing CPE SOAP messages and generating ACS SOAP
responses. It dispatches on the SOAP body's method name to type-specific parsers
for Inform, TransferComplete, GetParameterNamesResponse, etc. Supports CWMP
versions 1.0 through 1.4.

`cwmp.ts` is the HTTP-level CWMP request handler. It manages the session state
machine:

1. **State 0** -- Expects an Inform. Authenticates the device (Basic or Digest
   auth, configurable via expression). Acquires a distributed lock. Loads device
   data from MongoDB. Sends InformResponse.
2. **State 1** -- Waits for the CPE to send an empty POST (ready for ACS RPCs).
   Processes any TransferComplete messages.
3. **State 2** -- The ACS drives RPCs (GetParameterNames, GetParameterValues,
   SetParameterValues, AddObject, DeleteObject, Download, Reboot, FactoryReset).
   The CPE responds to each.

Session persistence across TCP disconnects: when a socket closes mid-session,
the entire `SessionContext` is serialized to Redis (the MongoDB `cache`
collection) and restored when the CPE reconnects (identified by a session
cookie).

### Session Engine (`lib/session.ts`)

The session engine implements the **declaration-driven data fetching** pattern.
Rather than issuing RPCs imperatively, provisions create `Declaration` objects
stating what paths and attributes they need to read or write. The engine then:

1. Processes all declarations into a `SyncState` -- a structured plan of which
   parameters to refresh, which values to set, which instances to create/delete,
   etc.
2. Generates the minimal set of CWMP RPCs needed to fulfill the plan.
3. After each RPC response, updates `DeviceData` and re-evaluates.
4. Iterates until all declarations are satisfied.

The preset system (`applyPresets` in `cwmp.ts`) implements a policy engine:
presets are rules with precondition expressions that, when matched, contribute
provisions to the session. After provisions execute, if device data changed,
presets are re-evaluated (up to 4 cycles to prevent infinite loops).

### Provisions and Virtual Parameters

**Provisions** are the unit of configuration intent. Built-in provisions
(`default-provisions.ts`) include `refresh`, `value`, `tag`, `reboot`, `reset`,
`download`, and `instances`. Custom provisions are user-defined JavaScript
scripts stored in the `provisions` MongoDB collection.

**Virtual parameters** are scripts that present computed/derived values as if
they were real device parameters under the `VirtualParameters.*` namespace. They
run in two phases: a "get" phase reads real parameters and returns a computed
value; a "set" phase translates a desired value into real parameter changes.
Virtual parameters can reference other virtual parameters (up to depth 8).

### Sandbox (`lib/sandbox.ts`)

The sandbox provides a secure execution environment for provision and virtual
parameter scripts using `vm.Script` with a 50ms timeout. It uses a
**replay-based execution model**:

1. A script runs and calls `declare()` to request data.
2. When `commit()` is called, the script throws a sentinel symbol and exits.
3. The engine fetches the requested data via CWMP RPCs.
4. The script is **re-run from the beginning** with the fetched data available.
5. Earlier `declare()` calls return cached results; the script progresses
   further.
6. This repeats until the script completes without throwing.

The sandbox API: `declare(path, timestamps, values)` returns a
`ParameterWrapper` proxy; `clear(path, timestamp, attributes)` invalidates
cached data; `ext(...args)` calls external extensions (results are cached per
revision to survive replays); `commit()` explicitly triggers a fetch cycle.
`Math.random()` is replaced with a seeded PRNG for determinism.

### Device Data Model (`lib/types.ts`, `lib/device.ts`)

`DeviceData` is the in-memory working copy of a device's parameter tree during a
session:

- `paths: PathSet` -- All known parameter paths.
- `timestamps: VersionedMap<Path, number>` -- When each path was last refreshed.
- `attributes: VersionedMap<Path, Attributes>` -- Per-path attributes (object,
  writable, value, notification, accessList), each paired with a timestamp.
- `trackers` / `changes` -- Change tracking for re-evaluation.

`VersionedMap` (in `versioned-map.ts`) provides multi-revision snapshots,
enabling the sandbox replay model where scripts may be re-run at different
revision levels.

`device.ts` handles setting and clearing parameter data with invariant
enforcement (e.g., if `value` is set, `object` is forced to 0; parent paths are
ensured to exist). The `unpack()` function resolves wildcards and alias paths
against concrete device data.

### NBI (`lib/nbi.ts`)

A raw Node.js HTTP listener (no framework) with regex-based URL routing.
Endpoints include CRUD for presets, provisions, virtual parameters, objects, and
files; device task management (with optional synchronous execution via
connection request); fault management; generic collection querying; and ping.

The NBI uses MongoDB-style JSON queries directly. For the `devices` collection,
`query.ts` expands user-friendly queries by auto-appending `._value` to
parameter paths and generating multi-type interpretations (string, number, date,
regex) for filter values.

### File Server (`lib/fs.ts`)

A minimal HTTP file server reading from MongoDB GridFS. Supports GET/HEAD with
full HTTP caching (ETag, Last-Modified, If-None-Match, If-Modified-Since) and
Range requests (HTTP 206) for partial content downloads. Files are cached
in-memory via memoization.

### UI Backend (`lib/ui.ts`, `lib/ui/`)

A Koa application with JWT authentication, role-based authorization, and a rich
CRUD API under `/api/`. The root route serves an HTML shell that bootstraps the
Mithril.js SPA with injected config, user info, and hashed asset filenames.

`lib/ui/api.ts` defines generic CRUD endpoints for all resource types (devices,
presets, provisions, files, config, users, permissions, faults, tasks) with
authorization checks at every level. Specialized endpoints handle file
upload/download, synchronous task execution, tag management, password changes,
and CSV export.

`lib/ui/db.ts` translates between the UI's flat parameter representation and
MongoDB's nested document structure. The `flattenDevice()` function is the key
transformation: it recursively walks the nested device document and produces a
flat key-value map with colon-delimited attribute keys (e.g.,
`"Device.WiFi.SSID.1.Name" -> value`,
`"Device.WiFi.SSID.1.Name:type" -> "xsd:string"`,
`"Device.WiFi.SSID.1.Name:writable" -> true`). The `FlatDevice` type is
`Record<string, Value>` where `Value = string | number | boolean | null`.

`lib/ui/local-cache.ts` caches permissions, users, and config in-process with
hash-based revision tracking. The `getConfig()` function uses typed overloads --
it takes a typed default value (`string`, `number`, or `boolean`) and an
expression evaluation callback, returning a value of the same type as the
default.

### Database Layer (`lib/db/`)

`db/db.ts` is the single entry point to MongoDB. It manages 14 collections:

| Collection          | Purpose                          |
| ------------------- | -------------------------------- |
| `devices`           | CPE device parameter trees       |
| `presets`           | Configuration rules              |
| `provisions`        | Provision scripts                |
| `virtualParameters` | Virtual parameter scripts        |
| `objects`           | Generic objects                  |
| `tasks`             | Queued device management tasks   |
| `faults`            | Error records with retry state   |
| `operations`        | In-flight async operations       |
| `files` (GridFS)    | Firmware images and config files |
| `permissions`       | RBAC rules                       |
| `users`             | User accounts                    |
| `config`            | Key-value configuration          |
| `cache`             | Distributed cache (TTL index)    |
| `locks`             | Distributed locks (TTL index)    |

`db/synth.ts` is the sophisticated expression-to-MongoDB query compiler. It
normalizes expressions, converts them to a Boolean satisfiability representation
using the `Clause` hierarchy, minimizes via Espresso, and emits MongoDB
`$and`/`$or`/`$not` filter objects. This is used by the UI backend.

`cwmp/db.ts` handles CWMP-specific persistence: loading the nested device
document into `DeviceData` (`fetchDevice`), diffing changes back into MongoDB
update operations (`saveDevice`), and managing faults, tasks, and operations.

### Query Systems

There are two separate query paths:

1. **NBI queries** (`lib/query.ts`) -- Processes MongoDB-style JSON queries from
   external API consumers. Expands parameter names, generates multi-type value
   interpretations, and passes through to MongoDB directly.

2. **UI/Expression queries** (`lib/db/synth.ts`) -- Compiles the internal
   expression language into optimized MongoDB filters via Boolean minimization.
   This is the more sophisticated path, used by the UI backend.

### Frontend (`ui/`)

A Mithril.js SPA with hash-based routing (`#!/`). Key modules:

- `app.ts` -- Route definitions. The `pagify()` function wraps each page into a
  `RouteResolver` that handles initialization, error boundaries, and data
  fulfillment.
- `layout.ts` -- Top-level layout (header, navigation, content, overlay).
- `store.ts` -- Centralized data store. Implements a query-based reactive cache
  with deduplication and incremental fetching. The `fulfill()` method (called
  after every render) batches pending queries, computes filter diffs via
  `unionDiff()`, and fetches only missing data. Connection monitoring polls
  every 3 seconds for server health, clock skew, and config changes.
- `components.ts` -- Component registry with a context propagation system. The
  proxied `m()` function resolves string component names and the `m.context()`
  API passes data (like the current device object) down the component tree
  without explicit prop threading.
- `smart-query.ts` -- Translates user-friendly `Label: value` searches into
  filter expressions with type-aware matching (string, number, timestamp, MAC
  address, tag).
- `task-queue.ts` -- Two-stage task pipeline: staging (user configures tasks)
  then queue (tasks are committed and executed via the backend).
- `dynamic-loader.ts` -- Lazy loading of heavy libraries (CodeMirror, YAML) via
  dynamic `import()`.

### Build System (`build/`)

The build is a self-bootstrapping esbuild pipeline (`npm run build` pipes
`build/build.ts` through esbuild then node). It produces:

- **Backend binaries** -- 5 entry points bundled for Node.js 12+ with shebang
  banners, executable permissions, and `.js` extension stripped.
- **Frontend bundle** -- `ui/app.ts` bundled for browsers (ESM, code-split) with
  content-hashed filenames.
- **CSS** -- `ui/css/app.css` bundled and minified with content-hashed output.
- **SVG sprite** -- All icons in `ui/icons/` optimized via SVGO and combined
  into a single sprite.

`build/assets.ts` is a compile-time bridge: at rest it contains placeholder
filenames; during build, the `assetsPlugin` replaces them with actual
content-hashed names so both backend and frontend reference the correct assets.

Build metadata includes the date and a hash derived from the git state, appended
to the package version.

## Cross-Cutting Concerns

### Multi-Level Caching

```
memoize.ts         In-process function cache (2-4 min, two-generation rotation)
     |
local-cache.ts     In-process snapshot cache (5s refresh, hash-based revisions)
     |
cache.ts           MongoDB-backed distributed cache (configurable TTL)
     |
MongoDB            TTL index auto-expiration
```

Each service has its own `local-cache` that periodically checks the distributed
cache for staleness. Distributed locks (`lock.ts`) coordinate rebuilds so only
one worker does the expensive computation.

### Configuration (`lib/config.ts`)

Three-tier priority: CLI args > environment variables (`GENIEACS_*`) > config
file (`config.json`) > defaults. Supports per-device overrides by appending
`-OUI-ProductClass-SerialNumber` to option names.

### Distributed Locking (`lib/lock.ts`)

MongoDB-based mutual exclusion using upsert + duplicate key detection. TTL
indexes prevent deadlocks from crashed processes. Clock skew tolerance of 30
seconds.

### Authentication

- **CWMP devices** -- HTTP Basic or Digest auth, configurable per-device via
  expressions (`auth.ts`).
- **UI users** -- JWT tokens in cookies. Passwords hashed with PBKDF2-SHA512
  (10000 iterations). Role-based authorization via `Authorizer` with
  expression-based filters and validators.

### Connection Requests (`lib/connection-request.ts`)

Three methods to ask a CPE device to initiate a CWMP session:

- **HTTP** -- Standard TR-069 connection request with Digest/Basic auth.
- **UDP** -- For NAT traversal (STUN-based) with HMAC-SHA1 signed messages.
- **XMPP** -- TR-069 Annex K via a full XMPP client (`xmpp-client.ts`).

### Extensions (`lib/extensions.ts`)

User-defined scripts executed in long-lived child processes (`genieacs-ext.ts`)
communicating via IPC. Processes are lazily spawned per script name and reused.
Each request gets a unique ID; responses are matched by ID with a configurable
timeout.

### Logging (`lib/logger.ts`)

Dual-stream structured logging (application + access logs). Supports simple and
JSON formats, systemd journal integration, and automatic log rotation detection.
Protocol traces can be written to a debug file in YAML or JSON format
(`debug.ts`).

### Three-Valued Logic

The system consistently implements SQL-style three-valued logic
(true/false/null). This is visible in expression evaluation, the `Clause`
hierarchy's separate true/false/null methods, and the 2-bit minterm encoding in
the Boolean minimizer. NULL means "unknown" and propagates through operations
following SQL semantics.

## Architectural Invariants

- **The expression system does not depend on any service-specific code.** The
  `lib/common/expression/` modules are pure and shared across all services.

- **The sandbox is deterministic across replays.** `Math.random()` is seeded
  from the device ID, `Date.now()` is controlled, and extension results are
  cached. A script re-run with the same inputs produces the same outputs.

- **Services share no in-process state.** All cross-process coordination goes
  through MongoDB (the `cache` and `locks` collections). Each worker process is
  independent.

- **Device data is never mutated in place during a session.** `VersionedMap`
  provides revision-based snapshots. The sandbox writes to new revisions;
  earlier revisions remain readable for re-evaluation.

- **CWMP session exclusivity.** A distributed lock (`cwmp_session_<deviceId>`)
  ensures only one session exists per device at a time. The lock is refreshed
  periodically and released at session end.

- **The UI backend never queries MongoDB with raw user input.** All queries go
  through the expression-to-MongoDB compiler (`db/synth.ts`), which validates
  and normalizes expressions before generating filters.
