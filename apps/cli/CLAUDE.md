# CLAUDE.md — apps/cli

Guidance specific to the CLI/stdio app. See the repo-root `CLAUDE.md` first
for workspace-wide commands and the layered package architecture.

## What lives here

`@lnwjud/cli` is the non-Electron entrypoint: a small argument parser plus the
process that launches the MCP server over stdio or local HTTP. It is also
compiled into `lnwjud-mcp-stdio.cjs`, the packaged stdio launcher that
`apps/desktop` bundles and ships as `lnwjud-mcp-stdio.cmd` (the entrypoint
Codex CLI and the OpenAI Secure MCP Tunnel connect to — see the README
"Connection modes" table).

```
src/index.ts              parseCliArgs / runCli — pure command parsing +
                           dispatch against an injected CliDependencies object
src/commands/*.ts         one file per subcommand (doctor, workspace,
                           mcp-stdio, mcp-http), each exporting a runX
                           function that takes its own narrow dependency
                           interface (resolver/starter) rather than the
                           full CliDependencies — makes them independently
                           unit-testable without stdio/process wiring
src/runtime/
  stdio-mcp-runtime.ts     createStdioMcpRuntime — wires application/storage
                           services into an McpServerOptions for stdio
src/bin/mcp-stdio.ts       the actual packaged executable entrypoint: reads
                           CLI flags/env, opens the SQLite DB, resolves the
                           workspace, and starts the stdio MCP runtime
```

## Commands

```bash
pnpm --filter @lnwjud/cli test        # vitest run
pnpm --filter @lnwjud/cli typecheck   # tsc --noEmit
pnpm --filter @lnwjud/cli build       # tsc --outDir dist
```

## Conventions specific to this package

- `parseCliArgs`/`runCli` in `src/index.ts` are pure and side-effect-free
  aside from the injected `write`/`writeError` functions — they return a
  `Result<CliCommand>` / process exit code rather than calling
  `process.exit` directly, which is what makes `index.test.ts` able to test
  dispatch without spawning anything.
- Each `src/commands/*.ts` file follows the same shape: a small resolver
  interface (e.g. `ConfiguredWorkspaceResolver`) and a starter interface
  (e.g. `McpStdioServerStarter`) are accepted as parameters instead of
  importing `@lnwjud/mcp-server`'s `startMcpStdio`/`startMcpHttp` directly in
  the testable code path — production wiring supplies the real
  implementation, tests supply fakes. Follow this pattern for new
  subcommands rather than calling application/mcp-server functions inline.
- `src/bin/mcp-stdio.ts` is the one file in this package allowed to do real
  I/O at module load (env/flag parsing, `fs.mkdirSync`, opening the SQLite
  database) — it's the composition root for the packaged launcher, not a
  place for new business logic. It hard-requires the machine root drive
  (`machineRootPath()` via `@lnwjud/workspace`) before starting.
- This package intentionally has no dependency on `@lnwjud/ipc-contracts`
  or Electron — keep it that way; Electron-specific wiring belongs in
  `apps/desktop` (which imports `startMcpStdio` from `@lnwjud/mcp-server`
  directly for its own in-process HTTP server, separate from this CLI).
