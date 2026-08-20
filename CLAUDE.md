# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

lnwjud (package name `lnwjud`, npm scope `@lnwjud/*`) is a Windows-first local
development gateway that exposes trusted local capabilities (filesystem, search,
Git, processes, Codex, Windows UI/browser automation, etc.) through the Model
Context Protocol (MCP). It ships as an Electron desktop app plus a CLI/stdio
runtime, backed by a layered set of workspace packages. The MCP runtime
currently advertises 208 tools.

Authoritative in-repo references (read these before large architecture changes):
- `docs/architecture/UPGRADE_ARCHITECTURE.md` — runtime topology, package
  boundaries table, and non-negotiable invariants for the v4 upgrade.
- `docs/architecture/TOOL_CONTRACT.md` — MCP tool schema/permission-class
  contract; Zod schemas in `packages/mcp-server/src/tools/` are the source of
  truth, this doc is the compatibility record.
- `docs/architecture/ROADMAP_PHASE_STATUS.md` — completed implementation phases.
- `README.md` — full user-facing docs, connection modes, security model, and
  the complete 208-tool catalog.

## Commands

This is a pnpm workspace (`pnpm@10.15.0`, Node `>=24 <25`) using `corepack`.
Run everything from the repo root unless noted.

```bash
corepack pnpm@10.15.0 lint             # eslint .
corepack pnpm@10.15.0 typecheck        # tsc --build (project references, see tsconfig.json)
corepack pnpm@10.15.0 test             # runs `test` in every package that has one (pnpm -r --if-present test)
corepack pnpm@10.15.0 test:integration # vitest run against tests/integration/*.test.ts
corepack pnpm@10.15.0 test:packaging   # vitest run tests/packaging/desktop-packaging.test.ts
corepack pnpm@10.15.0 test:release-gate
corepack pnpm@10.15.0 build            # builds every package (pnpm -r --if-present build)
corepack pnpm@10.15.0 desktop          # builds @lnwjud/desktop then launches it via electron
corepack pnpm@10.15.0 package:windows  # electron-builder NSIS installer (Windows only)
```

Run a single package's tests or a single test file with pnpm's `--filter`,
or `cd` into the package (tests are colocated as `*.test.ts` next to the
source they cover, using vitest):

```bash
corepack pnpm@10.15.0 --filter @lnwjud/mcp-server test
cd packages/mcp-server && npx vitest run src/tool-registry.test.ts
cd packages/mcp-server && npx vitest run -t "some test name"
```

Note: `packages/mcp-server`'s `test` script first rebuilds `@lnwjud/domain`,
`@lnwjud/capabilities`, and `@lnwjud/extensions` (and itself) before running
vitest — those are its workspace dependencies compiled to `dist/`. If you see
stale-looking test failures there after editing a dependency package, rebuild
it (`corepack pnpm@10.15.0 --filter @lnwjud/<pkg> build`) first.

Electron end-to-end tests (Playwright, requires a full build first):
```bash
corepack pnpm@10.15.0 test:e2e
```

`apps/desktop` is Windows/Electron-specific; its `build`/`package:windows`
scripts and native OCR bits (`native/windows-ocr`) will not run on non-Windows
CI without adjustment.

## Architecture

The codebase follows a strict layered/clean-architecture split, enforced by
pnpm workspace dependency direction — **`packages/domain` and
`packages/application` must never import Electron, React, SQLite, or MCP
transport classes.** Transport adapters (MCP server, CLI, Electron IPC) call
application services; they never bypass path/command/permission/ownership/audit
checks directly.

```
MCP clients (ChatGPT / Codex / Claude / other agents)
        │
        ▼
MCP stdio or loopback Streamable HTTP  (packages/mcp-server, apps/cli)
        │
        ▼
ToolRegistry (208 tools, Zod-validated)
        │
        ▼
application services + policy   (packages/application, packages/permissions)
        │
        ▼
filesystem/search/Git/process/Codex/Windows/browser adapters
        │
        ▼
storage + audit/activity   (packages/storage, packages/audit)
        │
        ▼
Electron IPC → Live Logs / renderer UI   (apps/desktop)
```

### Package boundaries (`packages/*`, `apps/*`)

| Package | Responsibility |
| --- | --- |
| `packages/domain` | IDs, `Result<T>`/`AppError` contracts, policy-neutral types |
| `packages/application` | workspace, file, search, Git, process, project, Codex, doctor use cases — the orchestration layer every entrypoint calls into |
| `packages/workspace` | workspace registration, root/path guards, secret policy |
| `packages/filesystem` | bounded text/binary reads, writes, checkpoints, patching |
| `packages/search` | ripgrep adapter, context-economy policy primitives |
| `packages/git` | argument-array Git adapter and structured parsers (read-only) |
| `packages/process` | owned process trees, bounded output buffers, cancellation |
| `packages/codex` | local Codex discovery and owned Codex tasks (no credential-file reads) |
| `packages/permissions` | safe/balanced/full/custom profiles and hard blocks |
| `packages/audit` | redaction and structured audit events |
| `packages/storage` | SQLite database, migrations, repositories |
| `packages/mcp-server` | MCP tool registry plus stdio/HTTP transports (see `apps/desktop/CLAUDE.md`-equivalent notes below) |
| `packages/capabilities` | local shell/CDP/Windows UI/input/vision/media/Office/scheduler/WSL capabilities |
| `packages/extensions` | skills catalog and local MCP server bridge |
| `packages/ipc-contracts` | shared dashboard API routes/types and Electron IPC contracts |
| `apps/cli` | CLI parser and local service entrypoints, incl. the packaged stdio launcher (`apps/cli/src/bin/mcp-stdio.ts`) |
| `apps/desktop` | Electron shell serving the dashboard as a website (HTTP + WebSocket), local HTTP MCP server, tunnel management |

All entrypoints (CLI, stdio launcher, desktop HTTP server) are intended to
call the same `packages/application` services so validation and permissions
stay consistent regardless of transport.

### Core conventions

- **Result type, not exceptions**: application/domain code returns
  `Result<T> = { ok: true, value: T } | { ok: false, error: AppError }` (see
  `packages/domain/src/errors.ts`). `AppError` has a closed `AppErrorCode`
  union, a message, and a `recoverable` flag. Use `ok()`/`err()`/`appError()`
  helpers rather than constructing the shape by hand.
- **MCP tools live in `packages/mcp-server/src/tools/*.ts`**, grouped by
  domain (`file-tools.ts`, `git-tools.ts`, `process-tools.ts`, etc.), each
  tool defined with a Zod input schema. `packages/mcp-server/src/tool-registry.ts`
  assembles the deterministic runtime tool order (verified by
  `tool-registry.test.ts`); `upgrade-catalog.ts` holds the additive v4 tools.
  Every tool carries a permission class — `READ` / `WRITE` / `EXECUTE` /
  `DANGEROUS` — that maps to the active permission profile
  (`packages/permissions`); `readOnlyHint`/`destructiveHint` are advisory
  metadata only and never substitute for the real policy check.
- **Destructive operations require `userConfirmed: true`** and are centrally
  classified (see `packages/mcp-server/src/destructive-policy.ts` and the
  Security model section of `README.md`). Disk formatting and machine
  shutdown/reboot are hard-blocked regardless of profile.
- Changing a tool's schema or permission class requires updating both the
  Zod schema and `docs/architecture/TOOL_CONTRACT.md`, plus the relevant
  contract test (e.g. `tool-registry.test.ts`, `tool-schema-registry.test.ts`).
- TypeScript is strict everywhere (`tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`, NodeNext ESM). ESLint forbids
  `any` and requires explicit function return types
  (`@typescript-eslint/no-explicit-any`, `explicit-function-return-type`).
- Packages expose `src/index.ts` directly in dev (via package.json `exports`
  `development` condition) and compiled `dist/index.js` otherwise — that's
  why some packages' `test`/`build` scripts explicitly build their workspace
  dependencies first (see `packages/mcp-server`'s `test` script).
- `LNWJUD_UNRESTRICTED=1` (see `.env.example`) is the default local dev mode
  and exposes fixed local drives to the workspace/capability boundary;
  destructive operations remain policy-gated regardless. Never commit a
  populated `.env`, a runtime tunnel key, or any plaintext credential.
