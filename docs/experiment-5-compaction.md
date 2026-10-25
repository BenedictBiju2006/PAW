# Experiment 5: within-turn context compaction

Before each model request, PAW rebuilds a model-facing view of the current turn. It keeps the newest **four complete exchanges** intact. An exchange is one assistant tool-call group plus all its tool results; parallel calls and provider metadata are retained together. Older completed groups become structured receipts and working state. Unresolved errors, confirmation requests and incomplete groups remain intact until verified recovery. Compaction is skipped when it would increase serialized size.

The original call/result journal and assistant text persistence are unchanged. No old model messages, call arguments or thought signatures are edited. The compactor removes whole old groups and inserts an assistant data summary, so there are no orphaned function responses. Provider adapters and schema-disclosure authorization are unchanged.

Working state records confirmed results, observed resource/collection/record/component identifiers, record scalar values and collection fields, observed revisions, disclosed schema versions/constraints, completed mutations and unresolved guidance. It comes from execution metadata and structured results, never from interpreting conversational prose. Repeated mutation results do not become new mutations or overwrite newer observations. Old schema versions are marked stale; the execution authority still lives independently in ToolSession/Tooling.

Verbose definitions and duplicate schema/search payloads are omitted from receipts. Projection is structural: whole long scalar fields are omitted with an omitted-fields marker, not cut into arbitrary text fragments. Retained resource and invocation IDs allow reinspection. Observations do not guarantee that a resource still exists; current authorization, concurrency checks and resource reads remain authoritative. If recent exchanges/unresolved errors/essential state cannot fit the existing context bound, PAW stops with its existing limit notice rather than separating calls from results or dropping blockers.

## Diagnostics and deployment

Apply **`202610260001_context_compaction_diagnostics.sql` before deploying**. It adds an owner-checked, service-role-only wrapper around the existing diagnostics RPC. No original journal, collection or interface data is rewritten; the old RPC remains available.

Developer Tools' existing request table now shows original accumulated exchange characters, sent exchange characters (including working state), exchanges compacted and approximate characters saved. Provider input/output/cached token accounting remains separate and unchanged. Old rows fall back to their original exchange sizes and show unknown compaction counts. The context-size guard now measures the actual optimized request, rather than rejecting an otherwise usable request based on the larger original exchange history.

The reported baseline is 186,885 input tokens over 24 requests, growing from 1,519 to 14,403 input tokens per request. No live benchmark environment was available in this chat, so no new provider-token savings are claimed. The focused synthetic regression checks material character savings, unchanged token accounting, complete journal payloads, unresolved recovery, parallel groups and Gemini's existing signed wire preparation.

## Files

- Agent `server/turn-context.ts` and `server/working-state.ts`: deterministic whole-group compaction and verified working state.
- Agent `server/orchestrator.ts`, `server/tool-session.ts`: separate original exchanges from request views and capture execution facts after journal persistence.
- Agent `model/diagnostics.ts`, `server/store.ts`, Chat `components/TokenDiagnostics.tsx`: persist and display compaction counters using the current workflow.
- Tooling `server/recovery.ts`, `server/public.ts`: reuse compact JSON-schema projection, including schema intersections.
- The forward migration, `tests/turn-compaction.test.ts`, `tests/integration.test.ts` and test registration in `package.json`: pairing/journal/accounting and RPC authorization coverage.

Feature paths are under `apps/web/src/features/`. Broad browser testing was intentionally omitted for this expedited change.
