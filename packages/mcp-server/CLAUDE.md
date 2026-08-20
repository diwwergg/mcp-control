# CLAUDE.md — packages/mcp-server

Guidance specific to the MCP tool registry and transports. See the repo-root
`CLAUDE.md` first for the `Result<T>` convention, permission classes, and the
overall package-boundary architecture.

## What lives here

This package is the MCP surface itself: it defines every tool's Zod schema,
assembles them into a deterministic `ToolRegistry`, enforces permission/
destructive-operation policy per call, and exposes stdio and loopback HTTP
transports. Nothing outside this package should construct MCP tool
definitions or talk to `@modelcontextprotocol/server` directly.

```
src/tools/*.ts            one file per tool domain (file-tools, git-tools,
                           process-tools, search-tools, workspace-tools,
                           capability-tools, codex-tools, skill-tools,
                           mcp-bridge-tools, batch-tools, context-tools,
                           file-page-tools, workspace-index-tools,
                           upgrade-tools); tool-types.ts holds the shared
                           McpToolDefinition/McpToolContext/
                           McpApplicationServices types every tool file
                           implements against
tool-registry.ts          ToolRegistry — imports every *-tools.ts module,
                           assembles the deterministic runtime tool list,
                           and is the single call/invoke path: schema
                           validation -> permission check -> destructive-
                           policy check -> application service call ->
                           result mapping -> activity tracking
upgrade-catalog.ts         the additive v4 tool set on top of the 184-tool
                           baseline (see docs/architecture/TOOL_CONTRACT.md)
tool-schema-registry.ts    JSON Schema generation/validation for tools/list
destructive-policy.ts      central classification of which calls require
                           userConfirmed: true, and the hard-blocked set
                           (disk format, shutdown/reboot) that no profile
                           can unlock
result-mapper.ts           Result<T>/AppError -> MCP CallToolResult mapping;
                           the only place error messages get sanitized for
                           the wire
server.ts / stdio.ts / http.ts   McpServer construction and the two
                           transport entrypoints (createMcpServer,
                           startMcpStdio, startMcpHttp)
context-engine.ts / context-economy.ts   deterministic (non-LLM) ranking
                           and noise-filtering for automatic discovery —
                           see the "Context Economy Engine" invariant in
                           docs/architecture/UPGRADE_ARCHITECTURE.md: it must
                           never act as a security deny list, only reduce
                           discovery cost
activity-tracker.ts / activity-log-file.ts   trace-correlated call logging
                           feeding the desktop Live Logs pipeline
parallel-tool-executor.ts / batch-tools.ts   compound/parallel execution —
                           must never bypass the same per-call policy path
                           a primitive tool goes through
```

## Commands

```bash
pnpm --filter @lnwjud/mcp-server test   # rebuilds @lnwjud/domain,
                                          # @lnwjud/capabilities,
                                          # @lnwjud/extensions and this
                                          # package's own dist/, then
                                          # vitest run
pnpm --filter @lnwjud/mcp-server typecheck
cd packages/mcp-server && npx vitest run src/tool-registry.test.ts
```

If tests reference stale behavior from a workspace dependency you just
edited (e.g. `@lnwjud/capabilities`), rebuild that dependency first — this
package's tests import compiled `dist/` output for those, not `src/`
directly, per the `test` script above.

## Adding or changing a tool

1. Add/edit the Zod schema and handler in the appropriate `src/tools/*.ts`
   file, implementing `McpToolDefinition` from `tool-types.ts`.
2. Register it in the relevant tool array consumed by `tool-registry.ts`
   (or `upgrade-catalog.ts` for additive v4 tools).
3. Assign the correct permission class (`READ`/`WRITE`/`EXECUTE`/
   `DANGEROUS`) — this drives Safe/Balanced/Full profile behavior via
   `@lnwjud/permissions`, independent of the advisory `readOnlyHint`/
   `destructiveHint` annotations.
4. If the operation is destructive (deletes data, formats disk, kills a
   process, etc.), wire it through `destructive-policy.ts` so it requires
   `userConfirmed: true` rather than adding ad hoc confirmation logic in the
   tool handler.
5. A tool returning a large/unbounded result must report truncation or a
   continuation token — never silently drop data a primitive tool could
   otherwise return in full (see invariant #1 in
   `docs/architecture/UPGRADE_ARCHITECTURE.md`).
6. Update `docs/architecture/TOOL_CONTRACT.md`'s tool table and rerun
   `tool-registry.test.ts` / `tool-schema-registry.test.ts`, which assert the
   exact runtime tool order and schema — the README's 208-tool catalog and
   this doc must stay in sync with the live registry, not the other way
   around.
