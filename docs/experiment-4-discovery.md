# Experiment 4: efficient discovery and execution

Discovery remains progressive and registry-owned. No renderer, UI component, migration, inference call, step limit or context-compaction mechanism is added.

## Usage and compatibility

Existing `search_tools({query,limit})` still returns summaries, which do not authorize execution. Existing `describe_tool({toolId})` still returns a detailed schema (with an additive version identifier).

Use the same tools for batch discovery:

```json
{
  "queries": ["create collection", "create record", "UI authoring"],
  "includeSchemas": true,
  "limit": 6
}
```

Or describe known related IDs together:

```json
{ "toolIds": ["create_collection", "create_record", "add_ui_components"] }
```

A batch returns at most six authorized compact schemas, required arguments, important constraints, examples and versions. Its schema/example payload is capped at 16,000 characters; omitted IDs are explicitly deferred and do not authorize execution. Focused queries are required when searching with schemas. Exact capability names outrank incidental mentions in other descriptions. Examples are syntax, not permission or current resource state: use verified IDs, current revisions and the collection's fields.

After receiving a schema in either workflow, the agent may invoke that capability without another description call. Independent invocations can share one model response; dependent invocations wait for actual results. The bootstrap prompt explains these rules.

## Authority and security

Registry-owned execution policies classify initial exposure, schema disclosure, read reuse and recovery groups. They are server configuration, not model-controlled result fields. `ToolSession` has no individual capability names, URI layouts or UI component types.

The executor issues private, in-memory disclosure receipts only for registered discovery handlers whose returned schema bytes and version match the authoritative registry and pass discovery authorization. A schema-looking resource, model assertion, error preview, failed/oversized response, unavailable entry or deferred entry cannot create a receipt. Receipts become usable only after the corresponding successful response is persisted and delivered. They do not survive the turn.

Versions cover the schema identity, serialized input schema, permissions and side effects. Invocation rechecks the current version, including after asynchronous authorization/confirmation. Initial exposure is fixed to the native bootstrap schemas at turn start; late registration does not silently expose a capability. Permissions, resource ownership, strict argument validation and trusted confirmation remain enforced. Even mutation-cache hits validate current arguments and authorization before reusing the confirmed result.

## Reuse and recovery

Repeated unchanged schemas return a short versioned reference to the earlier invocation. Mixed batches include schemas for new/changed entries and references for entries already received.

Read handlers still run and authorize every time. If an opted-in read returns the same data for the same arguments, its next response references the earlier full result and includes verified IDs/revision rather than another full payload. External changes return fresh data automatically. Confirmed mutations and revision conflicts invalidate resource reuse. No model messages, thought signatures or earlier journal events are rewritten or removed: these are new concise tool responses, not within-turn compaction.

Existing deterministic failure recovery uses registry policies and trusted disclosure receipts to reset the relevant counters. Unrelated successes do not clear resource-error tracking. Writes remain deduplicated; failed writes, conflicts, temporary failures and confirmation requests remain retryable. Read reuse does not eliminate backend reads, since doing so could bypass fresh authorization or hide external updates.

## Verification and benchmark status

The supplied reference is GPT-4.1-mini: 144,966 input tokens, 2,026 output tokens, 24 model requests and partial completion. The user confirmed the benchmark environment is inaccessible and will provide the next live result. Therefore there is no claimed live rerun or measured improvement against the targets.

| Metric                | Supplied baseline | Updated standardized benchmark   |
| --------------------- | ----------------: | -------------------------------- |
| Input tokens          |           144,966 | Pending user run; target <50,000 |
| Output tokens         |             2,026 | Pending user run                 |
| Model requests        |                24 | Pending user run; target <12     |
| Tool calls / failures |      Not supplied | Pending user run                 |
| Cached input tokens   |      Not supplied | Pending user run                 |
| Task completion       |           Partial | Pending user run                 |
| Context growth        |      Not supplied | Pending per-request diagnostics  |

The separate synthetic integration regression creates a heading, editable table, form and chart over an existing Movies collection in **four model requests, five tool calls and zero failures**, including independent component discovery, interface/revision inspection and record inspection. It verifies saved A2UI and unchanged collection data. Its provider is scripted and its usage events are fixtures; those token values are deliberately not presented as real benchmark measurements. The runner logs actual serialized context character growth for this fixture. A recorded run grew from 0 → 4,429 → 7,321 → 8,429 exchange characters; diagnostics separately record fixed system, tool-definition and history sizes. These values vary with schemas and instructions. Character counts are not token counts.

For the next live run, keep the original GPT-4.1-mini settings and exact prompt. Collect turn input/output totals, model requests, tool calls, cached-token coverage and `request_diagnostics`. Count failures from trusted tool-result events and verify all requested outcomes. Compare system/history/tool/exchange character counts separately from provider token counts. Unknown cached usage remains unknown, not zero. The optimization targets remain unverified until that run.

## Changed files

- `features/tooling/server/{registry,register,types,executor}.ts`, `contract.ts`, `public.ts`: registry policies, schema versions, validated disclosure receipts and execution checks.
- `features/tooling/server/{turn-knowledge,schema-example}.ts`: turn-local schema/read reuse and bounded registry-derived examples.
- `composition/tools.ts`: extensions to the existing search/describe handlers, balanced query matching, authorized batch bounds.
- `features/interfaces/server/tools.ts`: catalog-owned UI syntax examples, rather than mirrored schemas.
- `features/agent/server/{bootstrap-tools,tool-session,failure-tracker,prompts}.ts`, `features/tooling/server/mcp.ts`: metadata-driven initial exposure, generic invocation/auditing, recovery and efficient workflow instructions.
- `tests/discovery-efficiency.test.ts`, `tests/integration.test.ts`: batch disclosure, malicious/undelivered data, stale schemas, permission/race checks, reuse/invalidation and synthetic workflow coverage.
- `tests/architecture.test.ts`, `tests/tool-recovery.test.ts`, `package.json`: explicit additive discovery contract expectations, unchanged-read behavior and test registration. The original 22-tool fixture is retained. README and architecture/authoring/recovery documentation are updated to avoid obsolete describe-only instructions.

Feature/composition paths above are relative to `apps/web/src/`.
