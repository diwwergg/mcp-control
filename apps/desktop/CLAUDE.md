# CLAUDE.md — apps/desktop

Guidance specific to the Electron desktop app. See the repo-root `CLAUDE.md`
first for workspace-wide commands and the layered package architecture.

## What lives here

`@lnwjud/desktop` is the Electron shell: it owns the local loopback
Streamable HTTP MCP server, the OpenAI Secure MCP Tunnel lifecycle, the system
tray, and the React dashboard UI. It composes the same `packages/application`
services as `apps/cli`, wired up through Electron's main/preload/renderer
split.

```
src/main/       Electron main process (Node): window/tray lifecycle, IPC
                handlers, MCP HTTP server lifecycle, tunnel controller
src/preload/    contextBridge boundary — the only code with access to both
                ipcRenderer and window.lnwjud
src/renderer/   React 19 dashboard (Vite), organized as feature folders under
                renderer/features/* (dashboard, mcp, git, processes,
                workspaces, permissions, settings, live, worklog, doctor,
                capabilities, projects, shell, home)
e2e/            Playwright end-to-end specs (*.e2e.ts) driving the built app
```

## Commands (run from this directory, or with `pnpm --filter @lnwjud/desktop`)

```bash
pnpm build          # full build: main (esbuild) + preload (esbuild) + renderer (vite) + packaged stdio launcher
pnpm build:main      # main process only
pnpm build:renderer  # renderer only (vite build)
pnpm test            # vitest run --config vitest.config.ts --passWithNoTests
pnpm typecheck        # tsc -b
pnpm test:e2e         # full build, then playwright test (needs a built app; single worker, 30s timeout)
pnpm package:windows  # electron-builder NSIS installer — Windows only
```

Root-level `corepack pnpm@10.15.0 desktop` builds this package and launches it
via `electron ./dist/main/main.js`.

## IPC contract pattern — do not bypass it

Every main↔renderer interaction is a named channel defined once in
`packages/ipc-contracts/src/index.ts` (`ipcChannels` for renderer→main
`invoke`/`handle` pairs, `pushChannels` for main→renderer push events like
`lnwjud:event:log`) alongside the shared request/response TypeScript types.

When adding a new IPC operation, all three files change together:
1. `packages/ipc-contracts/src/index.ts` — add the channel name and its
   request/response types (and update `IpcResponseMap` / the exposed API
   surface type, e.g. `LnwjudApi`).
2. `src/main/main.ts` (or the relevant main-process module) — register the
   `ipcMain.handle(channel, ...)` implementation, generally delegating to
   `desktop-services.ts` / `packages/application`.
3. `src/preload/index.ts` — expose a typed method on `window.lnwjud` via
   `contextBridge`, calling `ipcRenderer.invoke(channel, payload)`.

The renderer must never call `ipcRenderer` directly — only through the
`window.lnwjud` surface the preload script exposes. This keeps
`contextIsolation` intact (verified by `e2e/electron-security.e2e.ts`).

## Main-process modules of note

- `main.ts` — app bootstrap, window/tray creation, all `ipcMain` handlers.
- `desktop-services.ts` — wires `packages/application`/`packages/storage`
  services into the `DesktopIpcServices` shape `main.ts` calls.
- `mcp-lifecycle.ts` — starts/stops/restarts the loopback Streamable HTTP MCP
  server (default `http://127.0.0.1:18765/mcp`, falls back to an ephemeral
  port if busy).
- `tunnel-controller.ts` / `tunnel-profile.ts` / `tunnel-exit.ts` — OpenAI
  Secure MCP Tunnel process management and DPAPI-encrypted runtime-key
  storage.
- `capability-runtime.ts` — Windows UI/browser/media capability wiring.
- `instance-lock.ts` — single-instance lock, including the
  `wantsMcpStdio`/`shouldHoldSingleInstanceLock` logic for the packaged stdio
  launcher path.
- `window.ts` — window creation, icon paths, and `isAllowedRendererUrl` origin
  allow-listing (do not weaken this without checking `electron-security.e2e.ts`).
- `log-hub.ts` — Live Logs buffer feeding `pushChannels.logEvent`.

## Renderer conventions

Feature folders under `src/renderer/features/*` are the unit of organization
— UI for a given dashboard area (e.g. `features/mcp`, `features/git`) stays
together. `App.tsx`/`main.tsx` are the composition root. i18n strings live
under `src/renderer/i18n` (`UiLocale` is `'th' | 'en'`, see
`ipc-contracts`). The renderer only talks to the backend through
`window.lnwjud` (typed by `LnwjudApi` in `@lnwjud/ipc-contracts`), never via
direct Node/Electron APIs — the renderer runs with `contextIsolation` and
without Node integration.

## Build pipeline details

`pnpm build` compiles four separate outputs, each with different bundler
settings — get the target right when editing esbuild/vite flags:
- `dist/main/main.js` — esbuild, ESM, Node platform, `electron` external, with
  a banner shim providing CJS `require` in an ESM main process.
- `dist/preload/index.cjs` — esbuild, CJS, browser platform (Electron preload
  constraints), `electron` external.
- `dist/renderer/` — `vite build` (`vite.config.ts`, React plugin, root is
  `src/renderer`).
- `build/lnwjud-mcp-stdio.cjs` — esbuild bundle of `apps/cli/src/bin/mcp-stdio.ts`
  (CJS, Node), then `scripts/write-stdio-launcher.mjs` writes the
  `lnwjud-mcp-stdio.cmd` launcher referenced throughout the README as the
  packaged stdio entrypoint for Codex/tunnel connections.

`electron-builder.yml` packages `dist/main`, `dist/preload`, `dist/renderer`,
and `build/icon.*` into a Windows NSIS installer; `npmRebuild: false` and
`asar: true` are both load-bearing for the native module setup — don't change
them without checking `native/windows-ocr` packaging still works.
