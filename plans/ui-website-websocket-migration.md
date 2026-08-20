# Convert desktop dashboard UI to a website served over HTTP + WebSocket

## Context

`apps/desktop` currently ships its React/Vite/TS dashboard as an Electron-only
renderer: `apps/desktop/src/main/window.ts` loads a bundled `file://.../index.html`
into a `BrowserWindow`, and the renderer talks to the main process exclusively
through `window.lnwjud` — a `contextBridge` API (`apps/desktop/src/preload/index.ts`)
backed by `ipcMain.handle`/`ipcRenderer.invoke` request/response channels and
one push channel (`pushChannels.logEvent`, sent via `webContents.send`) for
Live Logs. This only works inside Electron's renderer sandbox.

This change turns that UI into a real **website**: served over local HTTP so
it's reachable like any web page, using a **WebSocket** for real-time data
instead of Electron's IPC push channel, built with **React + Vite + TS +
Tailwind CSS**. Confirmed scope:
- Electron shell (tray, single-instance lock, native capabilities, tunnel
  process management) **stays** as the host backend process — only the
  dashboard's delivery/transport changes. The `BrowserWindow` loads the
  local website URL instead of a bundled `file://` renderer.
- **Full replacement**: every current IPC request/response channel becomes an
  HTTP endpoint; WebSocket carries real-time push (logs, plus dashboard
  snapshot updates after mutating actions) so the UI stays live without
  polling.
- **Tailwind scope**: install and wire up Tailwind (tooling only), restyle
  new pieces this task adds; leave the 17 existing feature folders' current
  CSS as-is — no full visual rewrite.

## Key facts from exploration

- Only **two renderer files** call `window.lnwjud` directly: `App.tsx` (all
  23 request/response calls) and `features/live/StandaloneLogViewer.tsx`
  (`getLogSnapshot`, `onLogEvent`, `clearLogBuffer`, `exportLogs`,
  `getDashboard` poll). The other 17 feature folders only receive props —
  they need **no changes**.
- `apps/desktop/src/main/main.ts` (`registerIpcHandlers`) already funnels
  every handler through a transport-agnostic `DesktopIpcServices` interface
  (23 methods) backed by `runtime.services` from
  `apps/desktop/src/main/desktop-services.ts`. This interface is reused as-is
  behind HTTP routes — no business-logic changes needed.
- The existing loopback MCP HTTP server
  (`packages/mcp-server/src/http.ts`, `origin-policy.ts`) already implements
  the loopback-only, origin-validated HTTP pattern this repo uses
  (`createOriginPolicy`/`localhostAllowedOrigins` from
  `@modelcontextprotocol/server`, re-exported by `@lnwjud/mcp-server`, which
  `apps/desktop` already depends on). Reused for the new dashboard server
  rather than inventing new origin-check logic.
- No Tailwind, no `ws` package, and no existing website/HTTP-served UI exist
  anywhere in the repo before this change — both are net-new dependencies.
- `packages/ipc-contracts/src/index.ts` defines `ipcChannels`, `pushChannels`,
  `IpcResponseMap`, `LnwjudApi` (Electron-specific) alongside plain,
  transport-agnostic data types (`DashboardSnapshot`, `WorkspaceSummary`,
  `LogLine`, request/response shapes, etc.). The data types stay; the
  Electron-specific constants/interfaces are replaced with an HTTP route
  table and WebSocket message types.

## Approach

### 1. New dashboard HTTP + WebSocket server (main process)

`apps/desktop/src/main/dashboard-server.ts`:
- Plain `node:http` server (mirroring `packages/mcp-server/src/http.ts`'s
  style) bound to `127.0.0.1` on a new configurable port (env
  `LNWJUD_DASHBOARD_PORT`, default `18766`, falling back to an ephemeral
  port if busy — same fallback behavior as the existing MCP port).
- Validates `Origin`/`Host` via `createOriginPolicy` from `@lnwjud/mcp-server`
  before handling any request (reject cross-origin/DNS-rebinding requests).
- Serves the built renderer as static files from `dist/renderer` for `GET /`
  and asset paths.
- Serves one REST route per current IPC channel under `/api/*` (e.g.
  `GET /api/dashboard`, `POST /api/workspaces`, `POST /api/mcp/start`,
  `POST /api/tunnel/start`, `GET /api/logs`, `DELETE /api/logs/:source`,
  etc.), each calling the corresponding `DesktopIpcServices` method. The
  existing `parse*Request`/`assertNoPayload`/validator functions from
  `main.ts` are ported to read from the HTTP method + JSON body/query
  instead of an IPC payload — the validation logic itself is unchanged.
- `exportLogs`'s `dialog.showSaveDialog` call stays server-side exactly as
  today (it's already triggered from the handler, not the renderer).

`apps/desktop/src/main/dashboard-ws.ts`:
- WebSocket server (new `ws` dependency) attached to the same HTTP server,
  path `/ws`, same loopback/origin validation.
- Broadcasts two message types: `{ type: 'log', payload: LogLine }` (replaces
  `broadcastToAllWindows(pushChannels.logEvent, ...)`, fed by
  `runtime.logHub.setOnLine`) and `{ type: 'dashboard', payload:
  DashboardSnapshot }`, emitted after any mutating `DesktopIpcServices` call
  (workspace select/add, process start/stop, mcp start/stop/restart, tunnel
  start/stop) so the UI reflects state changes without polling.

Wired into `apps/desktop/src/main/main.ts`: the `registerIpcHandlers(...)`
calls in `bootstrapDesktop`/`bootstrapLogViewerOnly` are replaced with
starting the dashboard HTTP+WS server against `runtime.services` /
`runtime.logHub`; the `ipcMain.handle` registrations and
`broadcastToAllWindows` IPC push are dropped.

### 2. Window loading changes

`apps/desktop/src/main/window.ts`:
- `createMainWindow`/`createLogViewerWindow` call `loadURL('http://127.0.0.1:<port>/')`
  (and `.../#log-viewer`) instead of `loadFile(rendererEntryPath)`.
- `isAllowedRendererUrl` changes from checking `protocol === 'file:'` +
  matching a bundled path, to checking `protocol === 'http:'` + hostname
  `127.0.0.1` + the resolved dashboard port.
- The `preload` is dropped from `webPreferences` (no more `contextBridge`
  surface is needed once the page talks HTTP/WebSocket directly like a
  normal site); `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, `webSecurity: true` are kept.
- `apps/desktop/src/preload/index.ts` and its esbuild build step in
  `apps/desktop/package.json`'s `build`/`build:main` scripts are removed,
  along with `apps/desktop/src/renderer/global.d.ts`'s `window.lnwjud`
  typing.

### 3. Renderer: HTTP + WebSocket client

`apps/desktop/src/renderer/api/client.ts` — one `fetch`-based function per
former `window.lnwjud` method, same signatures, hitting the new `/api/*`
routes (so `App.tsx` and `StandaloneLogViewer.tsx` only need their
`window.lnwjud.x(...)` calls swapped for `apiClient.x(...)` imports, not a
rewrite of their logic).

`apps/desktop/src/renderer/api/socket.ts` — a small WebSocket client
(auto-reconnect with backoff) exposing a subscribe function for `log` and
`dashboard` messages, replacing `window.lnwjud.onLogEvent` in both consumers.

`packages/ipc-contracts/src/index.ts`: `ipcChannels`, `pushChannels`,
`IpcResponseMap`, `LnwjudApi` (Electron/IPC-specific) are replaced with an
`apiRoutes` table (method + path per operation) and a `WsMessage`
discriminated union (`{ type: 'log'; payload: LogLine } | { type: 'dashboard';
payload: DashboardSnapshot }`) for both the server and the new renderer
client modules to import. All existing plain data-shape types are unchanged.

### 4. Tailwind setup (tooling only)

- `tailwindcss` + `@tailwindcss/vite` (Tailwind v4's Vite plugin — no
  separate PostCSS config needed) added to `apps/desktop`'s devDependencies.
- Plugin added to `apps/desktop/vite.config.ts`; `base: './'` changed to
  `base: '/'` now that the app is served over HTTP instead of loaded via
  `file://`.
- `@import "tailwindcss";` added to `apps/desktop/src/renderer/styles.css`
  (kept alongside the existing `@font-face`/custom rules — no removal of
  current styles).
- Tailwind utility classes used only for new elements this task introduces
  (e.g. a WebSocket connection-status indicator); existing feature
  components' markup/classes are left untouched.

## Verification

- `pnpm --filter @lnwjud/desktop typecheck` and `pnpm --filter @lnwjud/desktop test`.
- `pnpm --filter @lnwjud/desktop build` then
  `pnpm --filter @lnwjud/desktop exec electron ./dist/main/main.js` (or root
  `corepack pnpm@10.15.0 desktop`): confirm the main window loads
  `http://127.0.0.1:<port>/`, the dashboard renders, actions (workspace
  select, process start/stop, MCP start/stop, tunnel start/stop) round-trip
  over HTTP, and Live Logs / dashboard updates arrive over the WebSocket in
  real time.
- Open `http://127.0.0.1:<port>/` directly in an ordinary browser (outside
  the Electron window) to confirm it behaves as a real website against the
  same backend.
- `pnpm --filter @lnwjud/desktop test:e2e` (Playwright), with
  `e2e/electron-security.e2e.ts` updated for the new loadURL-based origin
  check.
