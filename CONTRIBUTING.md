# Contributing to GenieACS

## Questions and Support

Please use the [forum](https://forum.genieacs.com) for questions, help requests,
and general discussion. GitHub Issues are reserved for confirmed bug reports.

## Issues

We use GitHub Issues to track bugs. When filing a bug report:

- Provide a clear description of the problem.
- Include steps to reproduce the issue.
- Note the GenieACS version, Node.js version, and MongoDB version.
- Include relevant log output if applicable.

If you face interoperability issues with a CPE, it is more often than not a
device-specific issue. Please consult the [forum](https://forum.genieacs.com)
before opening an Issue.

## Pull Requests

Pull requests are welcome. For bug fixes, go ahead and open a PR directly. For
new features or significant changes, please discuss in the
[forum](https://forum.genieacs.com) first to ensure alignment with the project's
direction.

When submitting a PR:

- Keep changes focused. One PR should address one concern.
- Run `npm run lint` and `npm test` before submitting.
- Update documentation in `docs/` if your change affects user-facing behavior.
- Add tests where appropriate (see [Testing](#testing)).
- Write a clear PR description explaining what the change does and why.

## Code Style

### Naming Conventions

- **Variables and functions**: `camelCase`
- **Classes**: `PascalCase`
- **Interfaces and type aliases**: `PascalCase`, without an `I` or `T` prefix
- **Module-level constants**: `UPPER_SNAKE_CASE`
- **Private class members**: prefixed with underscore (`_name`, `_cache`)

Choose descriptive, meaningful names. A longer clear name is better than a short
ambiguous one.

### Imports

Organize imports in three groups, in this order:

1. Node.js built-in modules, using the `node:` prefix
2. External packages
3. Local project modules

Use `.ts` extensions for all local imports.

```typescript
import { readFileSync } from "node:fs";
import * as http from "node:http";

import { Collection } from "mongodb";

import { connect, disconnect } from "./db.ts";
import Path from "./common/path.ts";
```

### Functions and Exports

Use the `function` keyword for all named and exported function declarations.
Arrow functions should only be used for callbacks and short inline expressions.

```typescript
// Named/exported functions use function keyword
export function processRequest(req: Request): Response {
  // ...
}

// Arrow functions for callbacks
items.filter((item) => item.active);
promise.then((result) => {
  // ...
});
```

### TypeScript

- All function declarations must have explicit return types. This is enforced by
  ESLint.
- Using `any` is permitted where full typing would be impractical, but prefer
  more specific types when reasonable.
- Prefer `Record<string, T>` over `{ [key: string]: T }` for mapped types.
- Use type assertions (`as`) sparingly and only when you have stronger type
  knowledge than the compiler.

### Comments

Code should be self-documenting. Use comments sparingly and only when the "why"
is not obvious from the code itself. When you do comment, use inline `//` style.

Do not use JSDoc (`/** */`) or block comments (`/* */`).

```typescript
// Good: explains a non-obvious reason
// Escapes everything except alphanumerics and underscore
function escapeRegExp(str: string): string {
  /* ... */
}

// Good: links to an external reference
// Source: http://stackoverflow.com/a/6969486

// Good: flags a known limitation
// TODO support "MD5-sess" algorithm directive

// Bad: restates what the code does
// Loop through each item and increment the counter
for (const item of items) {
  counter++;
}
```

### Error Handling

Use `== null` (not `=== null || === undefined`) for null/undefined checks.
ESLint is configured to allow this.

## Testing

### When to Write Tests

Tests are most valuable for pure logic: parsers, data transformations,
algorithms, and utility functions where inputs and outputs are well defined. A
regression test accompanying a bug fix is also worthwhile to prevent the same
issue from resurfacing.

Not every change needs a test. Use judgment and consider the likelihood and cost
of breakage. Avoid writing tests that duplicate coverage already provided by
existing tests, and resist the urge to test trivial code just for the sake of
coverage numbers.

### Conventions

Tests use the Node.js built-in test runner (`node:test`) and assertion module
(`node:assert`). No external test libraries or mocking frameworks are used.

```typescript
import test from "node:test";
import assert from "node:assert";

void test("parseValue returns correct type for integer strings", () => {
  const result = parseValue("42");
  assert.strictEqual(result, 42);
});

void test("parseValue throws on invalid input", () => {
  assert.throws(() => parseValue(""), new Error("empty value"));
});
```

Key conventions:

- Prefix `test()` calls with `void` to satisfy the `no-floating-promises` lint
  rule.
- Keep tests flat. Do not nest `describe` blocks.
- Use descriptive test names that state what is being tested and the expected
  outcome.
- Use `assert.strictEqual()` for value comparisons and
  `assert.deepStrictEqual()` for objects and arrays.

Test files live in the `test/` directory and are named after the module they
test (e.g. `test/path.ts` tests `lib/common/path.ts`).

## Dependencies

This project deliberately keeps its dependency footprint small. Before adding a
new dependency:

- Prefer Node.js built-in APIs when they can do the job.
- Consider whether the functionality is simple enough to implement directly.
- Justify the addition in your PR description.

Do not add development tool dependencies (linter plugins, editor integrations,
etc.) without prior discussion.

## File Organization

| Directory     | Contents                                     |
| ------------- | -------------------------------------------- |
| `lib/`        | Core server-side application code            |
| `lib/common/` | Code shared between server and browser       |
| `lib/db/`     | Database layer (MongoDB)                     |
| `lib/ui/`     | UI backend helpers                           |
| `ui/`         | Frontend code (Mithril.js SPA)               |
| `bin/`        | Service entry points                         |
| `build/`      | Build tooling                                |
| `test/`       | Test files                                   |
| `docs/`       | User documentation (Sphinx/reStructuredText) |
| `public/`     | Static assets (favicon, logo)                |

Place new code in the directory that matches its purpose. Server-side logic
belongs in `lib/`, code that must run in both Node.js and the browser belongs in
`lib/common/`, and frontend-only code belongs in `ui/`.

## Documentation

User documentation lives in the `docs/` directory as reStructuredText files
built with Sphinx and published to
[docs.genieacs.com](https://docs.genieacs.com).

When your change affects user-facing behavior:

- Update the relevant documentation in `docs/`.
- If adding a new feature, consider whether it warrants a new page or a section
  in an existing page.
- Keep documentation concise and practical. Match the existing tone: direct,
  factual, no filler.

Documentation changes should be included in the same PR as the code change, not
submitted separately.

### ARCHITECTURE.md

`ARCHITECTURE.md` describes the high-level architecture of the project: the
service boundaries, major subsystems, data flow, and key invariants. It is aimed
at contributors who need a mental map of the codebase.

This file has a different update cadence than `docs/`. It should be revisited a
few times a year rather than kept in lockstep with every code change. When you
do update it, follow these principles:

- **Only describe things that are unlikely to change frequently.** Module
  responsibilities, service boundaries, key data structures, and architectural
  invariants belong here. Implementation details, function signatures, and
  config option lists do not.
- **Name important files, modules, and types but do not link them.** Links go
  stale. Encourage the reader to use symbol search to find named entities; this
  also helps them discover related, similarly named things.
- **Keep it short.** Every recurring contributor will read it. A shorter
  document is less likely to become stale and more likely to be maintained.
- **Describe the "what" and "where", not the "how".** This is a map of the
  country, not an atlas of its states. Pull detailed explanations into inline
  code comments or separate documents.
- **Call out architectural invariants explicitly.** Important invariants are
  often expressed as the _absence_ of something (e.g., "the expression system
  does not depend on service-specific code") and are hard to discover by reading
  code alone.

## Git Workflow

### Commit Messages

This project follows the
[Conventional Commits](https://www.conventionalcommits.org/) format:

    <type>(<scope>): <subject>

    [optional body]

- Use the imperative mood, present tense: "Fix bug", not "Fixed bug" or "Fixes
  bug".
- Do not capitalize the first letter of the subject (the type prefix handles
  visual structure).
- Do not end the subject line with a period.
- Keep the subject line under 72 characters.
- When more context is helpful, add a body separated from the subject by a blank
  line, wrapped at 72 characters. The goal is to provide enough information for
  someone scanning the commit history to find a specific change (e.g. for
  troubleshooting or rebasing) or to draft changelog entries for a release.
  Don't be verbose, but don't be cryptic either.

#### Types

| Type       | When to use                                                                 |
| ---------- | --------------------------------------------------------------------------- |
| `fix`      | Bug fixes                                                                   |
| `feat`     | New features or capabilities                                                |
| `refactor` | Code restructuring with no behavior change                                  |
| `test`     | Adding or updating tests                                                    |
| `docs`     | Documentation changes (`docs/`, `CONTRIBUTING.md`, `README.md`)             |
| `build`    | Build system, dependencies, esbuild config, `package.json` scripts          |
| `chore`    | Maintenance tasks that don't fit above (`.gitignore`, tooling config, etc.) |

#### Scopes

Scope is optional. Use it when it adds useful context; omit it when the change
is cross-cutting or the subject already makes it obvious.

| Scope  | Covers                              |
| ------ | ----------------------------------- |
| `cwmp` | CWMP service (including extensions) |
| `nbi`  | Northbound REST API service         |
| `fs`   | File service                        |
| `ui`   | Web UI (frontend and backend)       |
| `db`   | Database layer                      |

If a change touches multiple scopes, either pick the primary one or omit the
scope entirely.

#### Examples

    feat(nbi): add bulk device delete endpoint
    fix(cwmp): handle missing ParameterKey in InformResponse
    refactor(db): replace raw queries with parameterized calls
    fix(ui): correct parameter table sort order
    test: add XML parser edge case coverage
    docs: update provisioning guide for new API
    build: upgrade esbuild to v0.20

    fix(cwmp): increase server timeout to 2 mins

    To allow enough time for running unindexed queries in large
    deployments.

### Branches

- `master` is the main development branch.
- Create a feature or fix branch for your work and open a PR against `master`.
- Use concise, descriptive branch names in lowercase with hyphens:
  `fix-race-condition`, `support-xmpp-requests`.

## Changelog

The changelog (`CHANGELOG.md`) is maintained for each release and is written for
users and system administrators, not developers.

- Write entries as clear, user-facing prose. Do not copy commit messages
  verbatim.
- Each entry should describe what changed and, when helpful, why it matters.
- Group entries under a version heading with the release date:
  `## 1.2.13 (2024-06-06)`.
- Start each entry with a verb: "Fix", "Add", "Improve", "Remove", etc.
- Include enough context that a user can understand the impact without reading
  the code.

You do not need to update the changelog in your PR. The maintainer will add
changelog entries during the release process.

## Contributor License Agreement

By submitting a pull request to this repository, you acknowledge that, while
maintaining copyright, you grant GenieACS Inc. a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable license to reproduce,
prepare derivative works of, publicly display, publicly perform, sublicense, and
distribute your contributions and such derivative works under the AGPLv3 license
or any other license terms, including, but not limited to, proprietary or
commercial license terms.

You confirm that you own or have rights to distribute and sublicense the source
code contained therein, and that your content does not infringe upon the
intellectual property rights of a third party.
