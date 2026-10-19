# PAW

Persistent Agentic Workspaces. Milestone 3 adds live OpenAI Responses inference, discovery-driven tool execution, secure per-user credentials, and streaming chat alongside the A2UI v0.9.1 runtime and existing manual tools.

## Run locally

Use Node.js 24 (`.nvmrc`) and npm from the existing checkout; no additional Git worktree is needed.

```sh
npm ci
cp apps/web/.env.example apps/web/.env.local
# Fill in your Supabase project URL and publishable/anon key.
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env.local` or your server environment. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted for legacy projects. Never use a service-role key here. `.env.local` is ignored by Git; no OpenAI key is required.

Open `http://localhost:3000`. To explicitly fix the request origin, set `PAW_APP_ORIGIN=http://localhost:3000`, restart the app, and use that exact URL. Do not leave a production example origin set locally. Hostnames and ports must match; `localhost` and `127.0.0.1` are different origins. When unset, development accepts a matching request Host even when Next.js builds its internal URL using `0.0.0.0`. Production retains strict origin checks.

For production, set connection variables, run `npm run build`, then `npm start`. Use HTTPS. Behind a reverse proxy, set `PAW_APP_ORIGIN` to the public origin with no trailing slash. Connection variables are read at runtime. Sessions use HTTP-only, SameSite=Lax cookies, with Secure cookies in production. Every protected API request verifies the Supabase user; data access uses that user's token, never an administrative bypass.

## Apply database migrations

Apply only the migrations your database has not received, in filename order:

- Milestone 1 installation: apply [`202610200002_a2ui.sql`](supabase/migrations/202610200002_a2ui.sql), then [`202610200003_conversations.sql`](supabase/migrations/202610200003_conversations.sql).
- Milestone 1.5 installation (A2UI already applied): apply [`202610200003_conversations.sql`](supabase/migrations/202610200003_conversations.sql).
- All installations upgrading to Milestone 3: apply [`202610200004_agent.sql`](supabase/migrations/202610200004_agent.sql) after the earlier migrations.

In the Supabase dashboard, open **SQL Editor**, paste each pending file into a separate new query, and run it once. Apply pending migrations before using this app version. Never rerun an already-applied migration; the original milestone migrations remain unchanged.

For a fresh project, apply all migration files in filename order (including the Milestone 2 migration described below). Alternatively, use the Supabase CLI's normal migration flow:

```sh
supabase init # Only if you have not initialized CLI configuration
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

If earlier SQL was applied manually, reconcile the CLI migration history with `supabase migration repair` first. Repository integration alone does not confirm migrations have been deployed. Never run `tests/*bootstrap.sql`, `tests/auth-claims.sql`, or `tests/legacy-fixture.sql` on your hosted project.

In Supabase **Authentication → Sign In / Providers**, enable Email. Set your Site URL and allowed development/deployment URLs under **Authentication → URL Configuration**. Email confirmation is supported: confirm the account, return to PAW, and sign in. Keep confirmation enabled for production and configure a production SMTP sender before inviting real users. Password recovery and social login are outside this milestone. No storage bucket or realtime setup is required.

## Create and use an A2UI interface

1. Sign in and create a workspace.
2. Open **Collections & data**, create a collection, and define its fields. Supported types are string, number, boolean, date, and enum. Collection schemas remain immutable to protect existing records.
3. Add or edit records. Exact-match filtering, typed sorting, and bounded pagination remain available. Edits reject stale timestamps; destructive operations require confirmation.
4. Open **Interface builder**. Use the heading, form/table, and chart shortcuts or author A2UI messages directly. Validation and the preview update immediately.
5. Save, then open **Workspace** to use the resulting form, table, chart, inputs, and buttons. Changes go to Supabase without an LLM.
6. Reload or sign out and back in. The saved interface and records persist, and the workspace URL reopens the same workspace.

The preview is intentionally **read-only for persistent mutations**: you can exercise transient input bindings and tabs, but forms and table mutations are disabled, and record-creating button events are rejected. Save the interface and use the Workspace tab to change stored records. Unsaved preview state is transient and is not written into the saved definition.

## Official A2UI implementation

Protocol and package versions are different:

- Protocol: **v0.9.1**, the [current production specification](https://a2ui.org/specification/v0.9.1-a2ui/).
- Packages: pinned, compatible `@a2ui/react@0.14.0` and `@a2ui/web_core@0.14.0`.
- A root npm override pins the renderer’s transitive DOMPurify dependency to patched version 3.4.17. PAW text rendering does not enable HTML or Markdown.
- Imports use `/v0_9`, whose released message schemas explicitly accept v0.9.1.
- `MessageProcessor`, `A2uiMessageListWrapperSchema`, strict catalog/topology validation, the generic binder, two-way setters, event dispatch, and `A2uiSurface` come from the official packages.
- PAW supplies React implementations through the documented `createComponentImplementation` catalog extension API, using the official standard component property schemas and shared monochrome design tokens. PAW does not interpret a second node-tree protocol.

The authoritative definition is the official `{ "messages": [...] }` wrapper. A minimal example:

```json
{
  "messages": [
    {
      "version": "v0.9.1",
      "createSurface": {
        "surfaceId": "workspace",
        "catalogId": "https://paw.local/catalogs/workspace-v1.json"
      }
    },
    {
      "version": "v0.9.1",
      "updateComponents": {
        "surfaceId": "workspace",
        "components": [
          {
            "id": "root",
            "component": "Column",
            "children": ["heading", "entry", "table"]
          },
          {
            "id": "heading",
            "component": "Text",
            "text": { "path": "/title" },
            "variant": "h2"
          },
          {
            "id": "entry",
            "component": "CollectionForm",
            "collectionId": "COLLECTION_UUID"
          },
          {
            "id": "table",
            "component": "DataTable",
            "collectionId": "COLLECTION_UUID"
          }
        ]
      }
    },
    {
      "version": "v0.9.1",
      "updateDataModel": {
        "surfaceId": "workspace",
        "path": "/",
        "value": { "title": "My workspace" }
      }
    }
  ]
}
```

Replace `COLLECTION_UUID` with the ID shown in the collection schema panel. The catalog ID is a stable identifier, not a URL the runtime fetches; the catalog is registered locally. The definition can include up to eight surfaces, but all remain within the same workspace and revision. Each surface must have a `root` component. PAW bounds documents to 200 messages, 200 components per surface, 16 graph levels, and 250,000 characters. Cycles, dangling references, unsupported components/functions/events, and foreign collection bindings are rejected.

`updateComponents` and `updateDataModel` messages can be appended to a document and replayed to reconstruct its state. Component IDs remain stable. PAW limits component IDs to ASCII letters, digits, and underscores (starting with a letter or underscore), at most 64 characters. Updates are validated by the official processor. To remove components while maintaining strict no-orphan validation, edit the initial component set or delete and recreate the surface with the intended components using official messages. No records are deleted when surfaces or components change.

## Catalog, bindings, and actions

The catalog source is [`packages/a2ui/catalog.ts`](packages/a2ui/catalog.ts), with a generated [machine-readable JSON catalog](packages/a2ui/catalog.json). The authenticated `GET /api/catalog` endpoint exposes the same catalog. Regenerate JSON after schema changes with `npm run catalog:generate`. The builder displays the catalog for reference.

| Components              | Purpose                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `Text`                  | Text and heading variants `h1`–`h5`, `body`, `caption`                                         |
| `Column`, `Row`         | Layout through component ID references                                                         |
| `Card`, `Divider`       | Containers and separators                                                                      |
| `TextField`, `CheckBox` | Official dynamic values and two-way bindings                                                   |
| `Tabs`, `List`          | Tab children and static or data-model-template lists                                           |
| `Button`                | Official A2UI action dispatch                                                                  |
| `CollectionForm`        | Typed inputs from a persistent collection schema; creates a record                             |
| `DataTable`             | Persistent records; table/list presentation, editing, deletion, filtering, sorting, pagination |
| `CollectionChart`       | Full-collection value counts for a field; top 100 distinct values                              |

Persistent components require a static `collectionId` in the current workspace. `CollectionChart` also requires a valid field key. Their optional `title` is a dynamic string. Records are fetched from the authenticated API; they are not stored in interface JSON or treated as transient A2UI model state.

For ordinary inputs, bind a value using `{ "path": "/draft/title" }` and initialize it with `updateDataModel`. The official binder propagates input changes to other bound components. A Button can create a record with:

```json
{
  "id": "submit",
  "component": "Button",
  "child": "submit_label",
  "action": {
    "event": {
      "name": "paw.createRecord",
      "context": {
        "collectionId": "COLLECTION_UUID",
        "data": { "path": "/draft" }
      }
    }
  }
}
```

Declare `submit_label` as a Text component and reference `submit` from the root layout. `paw.refresh` is the other supported event. No arbitrary navigation, scripts, HTML injection, SQL, external network actions, or client functions are exposed. Text is rendered as plain React text rather than unsafe HTML/Markdown. Actual persistence still goes through the authorized `WorkspaceService`, and successful mutations refresh collection-backed views.

## Existing interfaces and revision history

The forward migration preserves every workspace, collection, record, RLS policy, and original revision payload. It changes the default for newly created workspaces and adds database validation for A2UI message envelopes, catalog components, properties, graph references, scopes, and limits. Existing record validators, immutable history capture, and optimistic revision updates remain in place. Application validation additionally uses the official full protocol/catalog processor, including nested dynamic properties and A2UI semantics.

Previously saved `{version:1,nodes:[...]}` definitions are converted **deterministically on read** by `packages/a2ui/legacy.ts`. Headings/text become Text components; layouts become Columns/Tabs; persistent components become PAW catalog components; refresh buttons become A2UI Buttons. Reserved IDs and legacy hyphens are renamed consistently with their references. The original database definition is unchanged until a user saves the converted A2UI definition as a new revision.

If conversion fails, the app displays an explicit compatibility error and exposes the untouched source in the builder for recovery. It never silently drops unknown components or overwrites the old definition. Data management remains available independently of interface recovery. Saving/restoring a legacy revision converts it through the same compatibility boundary before validation and creates a new revision. Existing revision JSON is never rewritten. The builder shows the latest 20 revisions and allows inspecting each original payload.

## Services and API

- `packages/a2ui`: official catalog schemas, validation/replay, inspection, shortcuts, and legacy conversion.
- `packages/core`: provider-independent workspace, collection, record, interface, and aggregation services.
- `apps/web/app/a2ui-runtime.tsx`: official React renderer and PAW catalog implementations.
- `apps/web/app/interface-builder.tsx`: editor and preview using that exact runtime.
- `apps/web/app/globals.css`: shared typography, spacing, borders, surfaces, radii, and interaction tokens, inspired by the four Ranked screens named in the task. No logo, decorative illustrations, gradients, or dashboard branding.

`WorkspaceService.inspect()`, `catalog()`, `saveInterface()`, and `applyInterfaceMessages()` are reusable by future authorized tools. Milestone 2 wraps these methods in the shared tool registry and MCP adapter; no LLM is connected.

| API path (under `/api`)                                         | Methods            | Purpose                                                                  |
| --------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| `/auth/signup`, `/auth/signin`, `/auth/signout`                 | POST               | Cookie-backed authentication                                             |
| `/auth/session`                                                 | GET                | Verified user identity                                                   |
| `/catalog`                                                      | GET                | Machine-readable PAW catalog (authenticated)                             |
| `/workspaces`                                                   | GET, POST          | List/create                                                              |
| `/workspaces/:id`                                               | GET, PATCH, DELETE | Load/rename/delete                                                       |
| `/workspaces/:id/collections`                                   | GET, POST          | Inspect/create collections                                               |
| `/workspaces/:id/collections/:collectionId`                     | GET, POST          | Query/create records                                                     |
| `/workspaces/:id/collections/:collectionId/:recordId`           | PATCH, DELETE      | Edit/delete records                                                      |
| `/workspaces/:id/collections/:collectionId/aggregate?field=key` | GET                | Counts and numeric aggregates                                            |
| `/workspaces/:id/interface`                                     | GET, PUT, PATCH    | Inspect, save `{definition, revision}`, or append `{messages, revision}` |
| `/workspaces/:id/revisions`                                     | GET                | Latest 20 original revision payloads                                     |

Record writes use `{data}`; edits also require `updatedAt`. Deletions require `{confirmed:true}`. Record queries accept `offset`, `limit` (1–100), `sort`, `direction` (`asc`/`desc`), `filter`, and exact typed `value`. Ownership is always derived from the verified session. Interface saves use compare-and-swap on the expected revision.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:integration
npm run test:browser
```

Integration/browser runners require Docker and create disposable local backends. They never use your hosted Supabase project. The integration runner applies the old migration, seeds a legacy workspace, then applies the new migration and verifies conversion, original history preservation, and rollback. It also covers persistent CRUD, RLS reads/writes, validation bypass attempts, scopes, revision conflicts, aggregates, sorting, and pagination.

The browser runner adds real local Supabase Auth (GoTrue) with auto-confirmation only in that disposable backend. It verifies sign-up/sign-in, interface authoring and immediate preview, invalid component rejection, two-way A2UI binding, A2UI-driven persistent writes, table/chart refresh, reload persistence, second-account isolation, CSRF checks, and desktop/mobile screens. It requires a production build and temporarily owns port 3100. It uses `CHROMIUM_PATH`, system `/usr/bin/chromium`, or Playwright's managed Chromium (`npx playwright install chromium`). Containers are removed on exit.

Hosted acceptance remains a separate check after applying the forward migration: sign in, create a collection and A2UI form/table, save, create/edit records, reload, sign out/in, and confirm a second account cannot access the workspace. Hosted migration deployment and production email delivery are not established by passing local tests.

## Milestone 2: discoverable tools and conversations

The manual **Workspace**, **Collections & data**, and **Interface builder** views remain available. **Chat** adds multiple persisted conversations per workspace. Create, rename, switch and delete conversations, and compose multiline messages. Messages are genuinely stored. Milestone 3 adds live AI responses when a provider is configured; no demo responses are generated. The same current workspace data and interface are shared across all conversations.

### Migration

For an existing installation, first apply `202610200002_a2ui.sql` if it has not been applied, then apply **[`supabase/migrations/202610200003_conversations.sql`](supabase/migrations/202610200003_conversations.sql)** once through Supabase SQL Editor or your normal migration deployment. Do not rerun earlier migrations. Fresh projects must apply all migration files in filename order. Repository pushes do not apply SQL automatically unless you have explicitly configured deployment.

`conversations` belongs to a workspace. `messages` uses a composite conversation/workspace foreign key, append-only access, a database sequence for stable message ordering, and provider-neutral structured content. RLS derives ownership from the workspace and applies to direct Supabase access too. Conversation identity cannot be moved between workspaces. Deleting a conversation cascades only its messages; deleting a workspace also removes its conversations. No existing interface revisions or records are rewritten.

### Registry and execution

- `packages/tools/registry.ts`: provider-independent metadata, deterministic keyword search and on-demand JSON Schema descriptions.
- `definitions.ts`: 22 tools with descriptions, purpose, keywords, input schemas, documented output structures, permissions and side effects. Handlers delegate to `WorkspaceService`; they do not duplicate its database operations.
- `executor.ts`: strict argument validation, host-granted permissions, optional workspace scope, structured errors and trusted-host confirmation for destructive requests.
- `resources.ts`: bounded resource metadata and authorized inspection through `paw://` identifiers.
- `mcp.ts`: official MCP TypeScript SDK adapter, instantiated per authenticated host context. It uses the same registry and executor; it does not establish a public MCP endpoint.

Bootstrap discovery consists of `search_tools`, `describe_tool`, `list_resources`, and `inspect_resource`. Search returns compact summaries rather than schemas. Describe returns the full schema, permissions, behavior, side effects and documented result structure. The executor returns `{ok:true,data}` or `{ok:false,error:{code,message,guidance,issues?}}`. Unknown operations and invalid arguments fail before service invocation. A validation/conflict response can be followed by inspection and a corrected retry.

| Capability  | Tools                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Discovery   | `search_tools`, `describe_tool`, `list_resources`, `inspect_resource`                                                   |
| Workspaces  | `list_workspaces`, `create_workspace`, `inspect_workspace`, `rename_workspace`                                          |
| Collections | `list_collections`, `inspect_collection`, `create_collection`                                                           |
| Records     | `query_records`, `create_record`, `update_record`, `delete_record`, `aggregate_records`                                 |
| A2UI        | `get_catalog`, `inspect_component`, `inspect_interface`, `apply_interface_messages`, `save_interface`, `list_revisions` |

Collection schemas remain immutable. Record edits require `updatedAt`; interface mutations require an expected `revision` and run through the existing official A2UI validator. `delete_record` has no confirmation argument. The default HTTP/MCP host returns `confirmation_required`; the user can delete through the existing manual UI. A future interactive host may inject `authorizeDestructive(toolId, exactValidatedArguments)` only after obtaining independent user approval. Never derive that callback or approval from agent output, tool arguments, or a request Boolean.

Authenticated `POST /api/tools` accepts `{toolId, arguments, workspaceId?}`. It preserves origin/CSRF checks, uses the verified session's user-scoped Supabase client, and grants only the known read/write/delete permissions. An optional workspace scope restricts operations to that authorized workspace; it cannot create a new workspace or escape through a resource URI. The agent cannot supply identity or permissions. Do not send credentials, executable code, SQL or shell commands to tools.

### Resources and MCP

`list_resources` accepts `kind`, optional `workspaceId`/`collectionId`, `offset` and `limit` (1–100), returning `{items,nextOffset}`. Each item has a URI, kind, name, description and MIME type. Actual record values require a separate query or inspection. Supported resource identifiers include:

| Resource           | URI                                                                            |
| ------------------ | ------------------------------------------------------------------------------ |
| Workspace          | `paw://workspaces/{workspaceId}`                                               |
| Collection         | `paw://workspaces/{workspaceId}/collections/{collectionId}`                    |
| Collection schema  | `paw://workspaces/{workspaceId}/collections/{collectionId}/schema`             |
| Record             | `paw://workspaces/{workspaceId}/collections/{collectionId}/records/{recordId}` |
| Current interface  | `paw://workspaces/{workspaceId}/interface`                                     |
| Component instance | `paw://workspaces/{workspaceId}/components/{surfaceId}/{componentId}`          |
| Revision           | `paw://workspaces/{workspaceId}/revisions/{revision}`                          |
| Catalog            | `paw://catalog`                                                                |

Inspection returns current service state, schema information, relationships and operation identifiers. Workspaces do not embed entire record collections. No resource state is reconstructed from chat.

The MCP adapter initially exposes only the four bootstrap tool schemas through `tools/list`. Other definitions are discovered via `describe_tool` and invoked via `tools/call`. `resources/list`, `resources/read`, and resource templates use the same authorized execution boundary. No hosted MCP listener or provider dependency is included. Tests connect the official SDK client and server over `InMemoryTransport`, discover tools, inspect schemas, invoke them and read resources; the direct registry and MCP adapter return the same results.

### Conversation API and Milestone 3 boundary

`ConversationService` implements workspace-scoped create/list/rename/delete, paginated ordered message retrieval, and validated append. JSON content supports text, tool calls (name, invocation ID, arguments, status), and tool results; optional metadata contains provider/model/invocation references. It is independent of provider request formats. The public browser endpoint accepts **only user text**, preventing callers from posing as assistant/tool activity through chat.

| API (under `/api/workspaces/:workspaceId`) | Methods       | Payload/results                                 |
| ------------------------------------------ | ------------- | ----------------------------------------------- |
| `/conversations`                           | GET, POST     | GET accepts `offset,limit`; POST `{title}`      |
| `/conversations/:id`                       | PATCH, DELETE | `{title}` or explicit manual `{confirmed:true}` |
| `/conversations/:id/messages`              | GET, POST     | GET accepts `offset,limit`; POST `{text}`       |

Lists return `{conversations,nextOffset}` or `{messages,nextOffset}`. Pagination is bounded and uses stable database ordering; it is not a multi-request snapshot during simultaneous writes. Milestone 3 adds backward pagination and streaming structured tool activity without requiring all history to load before sending.

Milestone 3 implements the provider-neutral inference/stream event adapter, encrypted per-user provider credentials, cancellation and usage bounds, and a server orchestrator that starts with workspace/conversation identity plus the bootstrap discovery tools. Persist normalized assistant/tool events through `ConversationService`; never treat a stored message as authorization or authoritative workspace state. Add a real user approval flow bound to exact destructive arguments before enabling agent-triggered deletes. Hosted MCP remains optional; both provider paths must keep using this executor. These features were outside Milestone 2 and are implemented in the Milestone 3 section below.

The existing five verification commands cover unit/adapter parity, deterministic tool exploration and persistence, stale/invalid operations, cross-workspace and direct-database RLS isolation, conversations and browser chat management. All integration and browser fixtures run against disposable local Docker backends, never hosted Supabase.

## Milestone 3: live agent and streaming chat

PAW now uses the Vercel AI SDK and **OpenAI Responses API** for real server-side inference. No ChatGPT subscription login is involved. Users supply their own separately billed API key through **Chat → AI settings**, validate access, choose a model, and replace/remove the key. Manual workspace, collection and interface tools remain accessible when AI is unconfigured or unavailable. Without a configured provider, chat can still save user text.

### Required deployment steps

1. Apply the new forward migration [`202610200004_agent.sql`](supabase/migrations/202610200004_agent.sql) **after all three previous migrations**. Paste the complete file into Supabase SQL Editor and run once, or deploy pending migrations with your usual CLI process. Never rerun previously applied files. The older deployed migrations are unchanged.
2. Set `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) on the **server only**, using the same Supabase project. This privileged client is used for encrypted settings, narrow trusted-event RPCs, and turn cancellation. Workspace tools still use the authenticated user's client and existing RLS/services.
3. Generate an independent encryption key with `openssl rand -base64 32` and set `PAW_CREDENTIAL_ENCRYPTION_KEY` on the server. Set `PAW_CREDENTIAL_KEY_VERSION=1`. Never send these secrets in chat, commit them, or prefix them with `NEXT_PUBLIC_`. Keep the encryption key stable and backed up separately from the database. Missing encryption configuration disables key persistence; there is no plaintext fallback.
4. Restart/redeploy, open a workspace's Chat tab, select **AI settings**, enter an OpenAI API key, and click **Validate & save**. Validation checks access to the chosen model with OpenAI's model endpoint; it makes no inference request.

Credentials use AES-256-GCM, a fresh 12-byte nonce, authentication tag, envelope/key-version metadata, and user/provider/version-bound associated data. A credential encrypted for one user cannot be decrypted as another user. Settings responses contain configuration state, model choices, warning preferences and usage, **never ciphertext or the API key**. Ordinary authenticated Supabase clients have no access to `provider_settings`. Encryption/decryption modules are reachable only from server routes, not browser components. Changing the encryption key/version without migrating existing ciphertext requires users to replace their saved keys; a multi-key rotation service is not implemented.

`PAW_OPENAI_MODELS` defaults to the documented Responses-compatible models `gpt-4.1-mini,gpt-4.1`. Administrators may configure a comma-separated list of verified supported model IDs. Saved selections must remain in that list and pass the provider access check. Only OpenAI is shipped; the orchestration tests use a second scripted provider with the same contract.

### Agent and streaming architecture

- `packages/agent/provider.ts` and `providers/openai.ts`: provider-neutral streaming/tool/usage/error/cancellation contract and its OpenAI AI SDK implementation. Dependencies are pinned to compatible installed versions. OpenAI requests use Responses, `store:false`, and no automatic request retries.
- `orchestrator.ts`: bounded multi-step loop over the existing registry and `ToolExecutor`. The initial model request exposes **only** the four bootstrap discovery tools plus `invoke_tool`. Dispatch requires successful `describe_tool` inspection during the current turn. The system prompt contains workspace/conversation identity and exploration/security instructions, not all tool schemas, record contents, component catalogs, or example application workflows.
- `context.ts`: recent bounded history; only genuine user messages and server-trusted assistant/tool output enter model context. Legacy assistant/system/tool inserts are not promoted to trusted instructions. Historical tool results are quoted as data; current workspace state must be inspected through tools.
- `store.ts`: trusted event persistence through ownership-checking, service-role-only RPCs. User messages are persisted atomically with turn acceptance **before inference**. Tool-start events are persisted before execution; tool results and partial/final assistant output are provider-neutral messages.
- `apps/web/lib/agent.ts`: verified-session streaming and cancellation host. The browser sends a conversation/workspace identity, latest text and stable turn UUID; it cannot supply roles, tools, provider keys, system prompts, permissions or historical messages.
- Chat uses `useChat`, `DefaultChatTransport`, `createUIMessageStream` and `createUIMessageStreamResponse`, following the AI SDK UI message SSE protocol. Native text chunks carry progressive output; SDK data parts carry actual tool activity, mutation invalidation and turn/usage status. No proprietary SSE parser or alternative UI schema is introduced.

The compact conversation sidebar becomes a navigation panel on mobile. Messages use restrained user bubbles and unboxed assistant Markdown. Raw HTML is skipped; the Markdown renderer's safe URL handling rejects script URLs. Code blocks have a copy action. The composer grows to a bounded height, supports Enter/Shift+Enter, and provides a stop control. Near-bottom readers follow streamed text; users reading earlier messages are not forcibly scrolled. Opening a conversation loads the newest 40 messages, with cursor-based backward pagination; sending does not require loading all history. Switching threads stops the old stream and requests cancellation without mixing its transcript into the new thread.

Tool details are collapsed by default and contain redacted arguments, actual execution status, and bounded results/errors. Successful write results emit a workspace invalidation event; PAW refreshes collections and the current A2UI definition without changing tabs or reloading the page. Existing record/A2UI validation, ownership and expected-revision checks remain mandatory. Destructive agent calls are **still blocked** and shown as approval-required; only genuine manual controls can authorize deletion in this milestone.

### Trusted messages, retries and cancellation

The migration removes the permissive message-insert policy. Direct authenticated clients can append only a single user text block, with empty metadata and no trusted/turn/event identity. Forged assistant/system/tool roles, claimed provider metadata, trusted flags and trusted-event RPCs are rejected. Trusted writes verify the initiating user's current ownership of the conversation and workspace inside each RPC. Existing history is preserved, but old non-user rows have `trusted=false` and are excluded from model instructions.

`agent_turns` records status, provider/model, request hash, token usage, cancellation state and completion notices. A stable client-generated UUID identifies each submission. A duplicate identity with the same input returns the existing turn; a mismatched payload fails. A database lock and unique active-turn index prevent overlapping inference within one conversation. Event identities are unique per turn. Identical mutation attempts within a turn reuse the first result, including uncertain failures, rather than issuing the same non-idempotent operation again. This is at-most-once attempt protection, not an assertion of transactional exactly-once semantics across a model and remote database.

Stop/disconnect aborts further model work; cancellation is also persisted and polled across server instances. An already executing database operation may finish, and its result is recorded before stopping subsequent work. Completed operations are never described as rolled back. A server crash can leave an invocation's outcome uncertain; pending turns older than ten minutes are marked interrupted when a new turn is accepted. Such turns are never automatically resumed or replayed. Inspect current workspace state before issuing a new request. **Check / retry request** uses the same identity, so it can safely check acceptance or retry a request that never started; it does not restart a completed/failed turn. There is no live stream reattachment or background job queue.

### Limits, usage and troubleshooting

| Server variable               | Default       | Maximum |
| ----------------------------- | ------------- | ------- |
| `PAW_AGENT_MAX_STEPS`         | 24            | 40      |
| `PAW_AGENT_MAX_TOOL_CALLS`    | 50            | 100     |
| `PAW_AGENT_TIMEOUT_MS`        | 120000        | 300000  |
| `PAW_AGENT_MAX_OUTPUT_TOKENS` | 8000 per turn | 20000   |
| `PAW_AGENT_MAX_RESULT_CHARS`  | 30000         | 60000   |
| `PAW_AGENT_MAX_CONTEXT_CHARS` | 160000        | 300000  |

Initial historical context is limited to 80 recent rows / 40,000 characters. New chat inference text is bounded to 20,000 characters; generated text is bounded to 50,000. Tool arguments, results, repeated requests and message journal sizes are bounded independently. Oversized tool results return a narrowing instruction, rather than dumping entire collections into context. Completed operations are retained when a limit is reached. Configure hosting to support streaming Node.js requests for the selected duration; the route exports `maxDuration=300`, but your platform's limits still apply.

Settings show available input/output token totals over the last 30 days (bounded to 10,000 turns) and a configurable **soft token warning**. Chat shows per-turn usage. Cost is marked **unknown**; no speculative pricing is used. The warning is not a hard provider billing cap. Failed/aborted requests may not yield complete usage; OpenAI billing remains authoritative.

Missing server credentials/encryption configuration produces a clear configuration error while manual tools remain usable. Invalid keys/model access, quota/rate limits, network outages, cancellation and bounds produce recoverable notices. Replace/validate a key in AI settings, inspect current state, and reload saved messages before deciding to submit a new request. Behind a proxy, preserve streaming responses and set `PAW_APP_ORIGIN` correctly; the stream sets `X-Accel-Buffering: no` and retains the existing authentication/CSRF boundary.

### Verification and live acceptance

Run the five standard verification commands above. Tests do **not** require an OpenAI key. Unit tests cover encryption/tampering/isolation, bounded trusted history, native stream framing, discovery gating, blocked destructive actions, duplicate mutations, normalized errors and partial-output cancellation. Isolated integration tests run a scripted second provider through the real orchestrator, ToolExecutor, Supabase/PostgREST services and new RPCs: create a movie collection and A2UI form/table, recover from invalid A2UI, query current data from another conversation and add a chart without losing records. They also prove direct-database forged-role rejection, credential isolation, idempotency and permission enforcement. Browser tests use an explicit test-only stream fixture plus real disposable persistence to verify Markdown safety, activity, mutation refresh, transcript reload, conversation switching, mobile navigation and the existing manual workflow.

Optional **paid**, explicitly enabled smoke test (never part of `npm test`):

```sh
PAW_LIVE_OPENAI_SMOKE=1 OPENAI_API_KEY=your-test-key npm run test:live
# Optional PAW_LIVE_MODEL must identify a model your API account supports.
```

After deployment, validate a real user key and exercise the scenarios in your Milestone 3 brief. No live paid call is implied by passing mocked tests. Next steps are production live acceptance, a real user approval flow before agent deletion, durable background execution/reattachment if hosting requires it, and stronger operational usage controls. Additional providers and hosted MCP remain optional future work; they must share this same registry/executor.
