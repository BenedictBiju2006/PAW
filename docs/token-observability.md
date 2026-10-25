# Token diagnostics and historical context

Apply the forward migration `202610250001_token_diagnostics.sql` before deploying this version. It adds a bounded `request_diagnostics` array to existing agent turns and an owner-checked, service-role-only RPC. It does not rewrite messages, interfaces or collection records. Older turns keep their totals and display “Per-request diagnostics are unavailable”.

Open **Developer Tools → Token diagnostics**, select a conversation, then expand a turn. The latest 20 turns show provider/model, status and totals. Each request row shows reported input/output/cached-input tokens, cumulative reported input/output tokens and context character counts. The view refreshes while Developer Tools is open.

Token counts come from the provider's normalized usage event. Missing counts display “Unknown”; a reported zero remains zero. Turn totals sum only reported counts, so missing usage is not evidence that a request was free. Cached usage can be partially available across requests. Failed or cancelled requests retain an incomplete row even if usage never arrives. A process crash can prevent the in-flight row from being saved.

Character counts measure the system string, serialized history at turn start, declared tool schemas/descriptions and accumulated exchanges at each request. They are estimates of context size, not tokenizer estimates or exact provider wire sizes. Provider adapters can encode schemas and messages differently. No prompts, credentials or tool payloads are copied into diagnostics. Discovery, provider conversation-storage settings, confirmations and active-turn replay remain unchanged.

## Historical compression

When preparing a new turn, trusted historical tool results become JSON-quoted, explicitly untrusted summaries. Each summary keeps tool identity, confirmed success/failure/unknown status, up to eight UUID/revision/count/boolean resource fields, an optional bounded PAW resource URI and a fixed outcome sentence. Failed results retain bounded error code (80 characters), message (240) and guidance (160). Arbitrary outcome prose, records, schemas, arguments and A2UI definitions/messages are omitted. Calls without confirming results never become successes.

A summary is at most 1,200 characters; tool summaries in one history message are at most 4,000 characters including their warning label. The existing 40,000-character overall history budget remains. Recent ordinary user and trusted assistant text is retained in order; tool summaries no longer consume space proportional to result size. Original persisted events remain untouched. The agent must inspect current resources and rediscover capabilities for each turn. This change does not compact active-turn exchanges or invoke a model to summarize history.

## Implementation map

- `features/agent/server/orchestrator.ts`, `diagnostics.ts`, `store.ts`, `contracts.ts`, `turn-status.ts`, `model/diagnostics.ts` and `public.ts`: measure, type, persist and expose per-request diagnostics through the existing turn-status endpoint.
- `features/agent/server/context.ts`: deterministic historical result allowlist and serialized size bounds.
- `features/providers/model/provider.ts` and `server/adapters/{openai,sdk}.ts`: preserve unavailable usage as unknown while retaining existing turn-total accounting and provider settings.
- `features/chat/components/TokenDiagnostics.tsx`, `client/sessions.ts`, `client.ts`, `styles/chat.css` and `features/workspaces/components/DeveloperTools.tsx`: conversation selection and an accessible, horizontally scrolling request table within Developer Tools.
- `supabase/migrations/202610250001_token_diagnostics.sql`: additive storage and numeric-only, owner-checked persistence RPC.
- `tests/agent.test.ts`, `tests/integration.test.ts`, `tests/browser/token-diagnostics.spec.ts`: provider fixtures, cumulative accounting, compression/security bounds, RPC ownership and desktop/mobile rendering coverage.

Feature paths above are relative to `apps/web/src/`.
