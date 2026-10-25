# Tool discovery and error recovery (PAW 1.2.1)

Recovery remains deterministic and local to the current agent turn. There are no migrations, provider changes, extra model calls, UI changes, token compaction or larger limits.

## Schema recovery

An invocation of an undescribed capability still does not execute. Its `schema_required` error now includes:

- `nextAction: {tool: "describe_tool", arguments: {toolId: "..."}}`;
- a registry-derived compact `inputSchema` with required arguments, property types, enums, formats, bounds and short patterns;
- a clear instruction to perform discovery before retrying.

Hints omit descriptions, recursive definitions and large defaults. They are bounded to 4,000 characters, three schema levels and a small property/node budget; `details: "describe_tool"` identifies omitted detail. Input-mode conversion distinguishes required arguments from defaulted optional arguments. Registry validation remains authoritative. As of [Experiment 4](experiment-4-discovery.md), successful compact batch discovery can disclose schemas too. Previewing a schema never marks the capability as described. A failed, unauthorized or oversized description does not grant described state either.

Both `invoke_tool` and unexpected direct domain calls use the same guard. Search results, descriptions and recovery previews respect execution permissions and workspace scope. Destructive capabilities still require the existing trusted confirmation callback before execution.

## URI feedback

Malformed identifiers return `resource_invalid`, supported `uriPatterns` and a concrete `nextAction` using `list_resources`. Authorized workspace context supplies concrete workspace prefixes. Collection/schema/record suggestions use `/collections/{collectionId}`, `/collections/{collectionId}/schema` and `/collections/{collectionId}/records/{recordId}`. Component instances use `/components/{surfaceId}/{componentId}`; UI type/schema discovery instead points to `search_ui_components` after `describe_tool`.

A collection ID appears in a record-listing suggestion only after the collection service confirms authorization. Otherwise the next action lists accessible collections. Private/guessed resource IDs are never copied into suggestions.

Known workspace-scope violations return `forbidden`. Missing resources return `not_found`. For an unscoped caller, nonexistent and inaccessible workspace IDs intentionally receive identical `not_found` feedback: ownership/RLS must not become an existence oracle. Temporary database/service errors retain their retryable `operation_failed` category.

## Failure patterns

The turn tracks failures by tool and category, not just identical argument hashes. The second related error highlights the alternative action. Further equivalent schema-invalid arguments or malformed URI guesses receive `recovery_required` without executing the target. Corrected schema-valid arguments and corrected URI shapes can proceed immediately.

After two missing-resource guesses in the same URI family, perform the supplied listing/discovery action before guessing more IDs in that family. Switching to a different resource family remains possible. Successful relevant listing, inspection or tool description resets the corresponding tracking. Unrelated successes do not reset resource guessing. New turns start with empty tracking.

Revision conflicts, temporary operation failures and confirmation requests are excluded from pattern blocking and repeated-attempt counters. Only successful writes enter the existing mutation cache; failed writes can genuinely retry. Successful mutation deduplication, call/result journaling, authorization and trusted confirmations remain intact. Repeated eligible reads/descriptions now return unchanged-result references; other non-retryable operations retain the original identical-call bound.

## Files and verification

- `features/tooling/server/{executor,recovery,types,public}.ts`, `features/tooling/contract.ts`: permission-checked previews, compact hints and structured trusted feedback.
- `composition/{tools,resources,resource-guidance}.ts`: permission-filtered discovery and authorized URI patterns/listing guidance.
- `features/agent/server/{tool-session,failure-tracker}.ts`: turn-local pattern detection, delivery-aware discovery and retry-safe mutation caching.
- `tests/tool-recovery.test.ts`, `tests/tools.test.ts`, `tests/integration.test.ts`: compact schemas, authorization/privacy, malformed/missing resources, corrected retries, failed descriptions, provider-neutral orchestration, confirmation and mutation deduplication coverage. `package.json` includes the focused unit suite.

Source paths above are relative to `apps/web/src/`. Existing public tool schemas and the tool-contract baseline remain unchanged; error feedback gains optional structured fields and malformed URI errors now have their own category.
