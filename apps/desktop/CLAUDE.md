# CLAUDE.md — apps/desktop

Guidance specific to the Electron desktop app. See the repo-root `CLAUDE.md`
first for workspace-wide commands and the layered package architecture.

## What lives here

`@lnwjud/desktop` is the Electron shell: it owns the local loopback
Streamable HTTP MCP server, the OpenAI Secure MCP Tunnel lifecycle, the system
tray, and a loopback dashboard website (HTTP + WebSocket) that serves the
React dashboard UI. It composes the same `packages/application` services as
`apps/cli`. The `BrowserWindow` is just a thin client that loads that local
website — the same dashboard is also reachable from any ordinary browser
pointed at the loopback URL shown in the window.

```
src/main/       Electron main process (Node): window/tray lifecycle, the
                dashboard HTTP+WebSocket server, MCP HTTP server lifecycle,
                tunnel controller
src/renderer/   React 19 dashboard (Vite + Tailwind), organized as feature
                folders under renderer/features/* (dashboard, mcp, git,
                processes, workspaces, permissions, settings, live, worklog,
                doctor, capabilities, projects, shell, home), plus
                renderer/api/* (fetch client + WebSocket client)
e2e/            Playwright end-to-end specs (*.e2e.ts) driving the built app
```

## Commands (run from this directory, or with `pnpm --filter @lnwjud/desktop`)

```bash
pnpm build          # full build: main (esbuild) + renderer (vite+Tailwind) + packaged stdio launcher
pnpm build:main      # main process only
pnpm build:renderer  # renderer only (vite build)
pnpm test            # vitest run --config vitest.config.ts --passWithNoTests
pnpm typecheck        # tsc -b
pnpm test:e2e         # full build, then playwright test (needs a built app; single worker, 30s timeout)
pnpm package:windows  # electron-builder NSIS installer — Windows only
```

Root-level `corepack pnpm@10.15.0 desktop` builds this package and launches it
via `electron ./dist/main/main.js`.

## Dashboard HTTP + WebSocket contract — do not bypass it

The renderer is a real website served by `src/main/dashboard-server.ts`, not
an Electron-only context-bridged page. Every operation is a REST route under
`/api/*`; real-time push (Live Logs, and a `dashboard` snapshot after any
mutating call) goes over a WebSocket at `/ws`. Routes, WS message shapes, and
the renderer's client-interface contract are all defined once in
`packages/ipc-contracts/src/index.ts` (`apiRoutes`, `WsMessage`,
`DashboardApiClient`) — transport-agnostic request/response types live there
too and are shared by both the server and renderer sides.

When adding a new dashboard operation, these files change together:
1. `packages/ipc-contracts/src/index.ts` — add the route to `apiRoutes`, the
   request/response shapes to `ApiRequestMap`/`ApiResponseMap`, and the
   method to `DashboardApiClient`.
2. `src/main/desktop-service-contract.ts` — add the method to
   `DesktopIpcServices` (the transport-agnostic service interface) and its
   `defaultDesktopServices` fallback.
3. `src/main/desktop-services.ts` — implement the method against
   `packages/application`/`packages/storage`.
4. `src/main/dashboard-server.ts` — add the `case` in `dispatchApiOperation`
   (with a `parse*Request` body validator if the route takes a body).
5. `src/renderer/api/client.ts` — add the matching `apiClient` method.

The renderer must never talk to Electron IPC directly — only `fetch`/`
WebSocket` against same-origin routes (see `src/renderer/api/client.ts` and
`api/socket.ts`). There is no preload script or `contextBridge` surface;
`contextIsolation`/`sandbox`/no-Node-integration are enforced purely by the
`BrowserWindow` config in `window.ts` (verified by
`e2e/electron-security.e2e.ts`).

## Main-process modules of note

- `main.ts` — app bootstrap, window/tray creation, starts the dashboard
  server/WebSocket and wires log/mutation events into WS broadcasts.
- `dashboard-server.ts` — loopback HTTP server: serves the built renderer as
  static files, dispatches `/api/*` routes to `DesktopIpcServices`, validates
  `Origin` via `@lnwjud/mcp-server`'s `createOriginPolicy` (default port
  `18766`, env `LNWJUD_DASHBOARD_PORT`, falls back to an ephemeral port if
  busy — same pattern as the MCP HTTP server).
- `dashboard-ws.ts` — attaches a `ws`-based WebSocket server at `/ws` to the
  same HTTP server (`server.on('upgrade', ...)`), broadcasting `WsMessage`s.
- `desktop-service-contract.ts` — the `DesktopIpcServices` interface and its
  `defaultDesktopServices` fallback (transport-agnostic; no Electron import).
- `desktop-services.ts` — wires `packages/application`/`packages/storage`
  services into the `DesktopIpcServices` shape.
- `mcp-lifecycle.ts` — starts/stops/restarts the loopback Streamable HTTP MCP
  server (default `http://127.0.0.1:18765/mcp`, falls back to an ephemeral
  port if busy). This is a separate server/port from the dashboard.
- `tunnel-controller.ts` / `tunnel-profile.ts` / `tunnel-exit.ts` — OpenAI
  Secure MCP Tunnel process management and DPAPI-encrypted runtime-key
  storage.
- `capability-runtime.ts` — Windows UI/browser/media capability wiring.
- `instance-lock.ts` — single-instance lock, including the
  `wantsMcpStdio`/`shouldHoldSingleInstanceLock` logic for the packaged stdio
  launcher path.
- `window.ts` — window creation, icon paths, `loadURL`s the dashboard
  website, and `isAllowedRendererUrl` origin allow-listing for in-page
  navigation (do not weaken this without checking `electron-security.e2e.ts`).
- `log-hub.ts` — Live Logs buffer; `main.ts` forwards its lines into the
  dashboard WebSocket as `{ type: 'log', ... }` messages.

## Renderer conventions

Feature folders under `src/renderer/features/*` are the unit of organization
— UI for a given dashboard area (e.g. `features/mcp`, `features/git`) stays
together. `App.tsx`/`main.tsx` are the composition root; `App.tsx` and
`features/live/StandaloneLogViewer.tsx` are the only two files that call the
API/WebSocket clients directly — every other feature component receives data
via props, so most UI changes never touch the transport layer. i18n strings
live under `src/renderer/i18n` (`UiLocale` is `'th' | 'en'`, see
`ipc-contracts`). Tailwind is wired up (`@tailwindcss/vite`,
`@import "tailwindcss"` in `styles.css`) but used only for new elements —
existing feature components keep their current hand-written CSS.

## Build pipeline details

`pnpm build` compiles three separate outputs, each with different bundler
settings — get the target right when editing esbuild/vite flags:
- `dist/main/main.js` — esbuild, ESM, Node platform, `electron` external, with
  a banner shim providing CJS `require` in an ESM main process. This bundles
  `dashboard-server.ts`/`dashboard-ws.ts` (including the `ws` dependency)
  along with the rest of `src/main/**`.
- `dist/renderer/` — `vite build` (`vite.config.ts`, React + Tailwind
  plugins, `base: '/'` since it's served over HTTP now, root is
  `src/renderer`). `dashboard-server.ts` serves this directory's files.
- `build/lnwjud-mcp-stdio.cjs` — esbuild bundle of `apps/cli/src/bin/mcp-stdio.ts`
  (CJS, Node), then `scripts/write-stdio-launcher.mjs` writes the
  `lnwjud-mcp-stdio.cmd` launcher referenced throughout the README as the
  packaged stdio entrypoint for Codex/tunnel connections.

`electron-builder.yml` packages `dist/main`, `dist/renderer`, and
`build/icon.*` into a Windows NSIS installer; `npmRebuild: false` and
`asar: true` are both load-bearing for the native module setup — don't change
them without checking `native/windows-ocr` packaging still works.
