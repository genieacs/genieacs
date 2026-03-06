# AGENTS.md — GenieACS

GenieACS is a TR-069 Auto Configuration Server for remote management of CPE
devices (routers, modems, gateways). TypeScript codebase compiled with esbuild,
backed by MongoDB.

## Architecture Overview

Four services share a single MongoDB instance:

- **CWMP** (port 7547) — TR-069 protocol handler; manages device sessions
- **NBI** (port 7557) — Northbound REST API for external consumers
- **FS** (port 7567) — File server for firmware/config (GridFS-backed)
- **UI** (port 3000) — Web interface (Koa backend + Mithril.js SPA frontend)

Key subsystems: expression engine (`lib/common/expression/`) compiles a
Lisp-like DSL used for queries, config, and authorization; session engine
(`lib/session.ts`) drives CWMP interactions via declarations rather than
imperative RPCs; sandbox (`lib/sandbox.ts`) runs user-defined provision scripts
in `vm.Script` with deterministic replay.

Read `ARCHITECTURE.md` for a full map of the codebase when working on unfamiliar
areas. It covers service boundaries, the expression pipeline, the path system,
the CWMP session state machine, the database layer, and architectural
invariants.

## Project Structure

- `lib/` — Core server-side logic
- `lib/common/` — Shared code (runs in both Node.js and browser)
- `lib/db/` — MongoDB database layer
- `lib/ui/` — UI backend helpers
- `ui/` — Frontend SPA (Mithril.js)
- `bin/` — Service entry points (5 executables)
- `build/` — Build scripts (esbuild pipeline)
- `test/` — Unit tests (node:test)
- `docs/` — User docs (Sphinx/reStructuredText)
- `public/` — Static assets (favicon, logo)

## Build / Lint / Test Commands

```bash
npm run build # Production build (esbuild pipeline -> dist/)
NODE_ENV=development npm run build # Dev build (no minification)
npm run lint # Prettier + ESLint + tsc --noEmit in parallel
npm test # Compile tests with esbuild, run with node --test
```

### Running a Single Test File

```bash
esbuild --log-level=warning --bundle --platform=node --target=node18 \
  --packages=external --sourcemap=inline --outdir=test test/path.ts \
  && node --test --enable-source-maps test/path.js \
  && rm test/path.js
```

### Running a Single Test Case

```bash
esbuild --log-level=warning --bundle --platform=node --target=node18 \
  --packages=external --sourcemap=inline --outdir=test test/path.ts \
  && node --test --enable-source-maps --test-name-pattern="^parse$" test/path.js \
  && rm test/path.js
```

### Lint Sub-commands

```bash
prettier --prose-wrap always --write .
eslint 'bin/*.ts' 'lib/**/*.ts' 'ui/**/*.ts' 'test/**/*.ts' 'build/**/*.ts'
tsc --noEmit
```

## Before Committing

Read `CONTRIBUTING.md` and ensure your changes comply with it. In particular:

- Run `npm run lint` and `npm test` and fix any failures.
- Follow the code style, naming, import, and comment conventions documented
  there.
- Use the Conventional Commits format for commit messages.
