# PAW — Minimum Viable Product Requirements

**Version:** 0.3  
**Status:** Initial development specification  
**Platform:** Browser-based web application (desktop-first responsive UI)  
**Architecture:** Next.js + React frontend, server-side agent/runtime, Supabase PostgreSQL persistence  
**Initial AI provider:** OpenAI Responses API, using a user-supplied API key  
**Provider strategy:** Model-agnostic provider abstraction, with application-managed tool orchestration as the portable baseline

## 1. Project overview

PAW is a web application in which authenticated users create persistent, interactive workspaces through conversation. Each workspace has one mutable interface, its own structured data, and multiple associated conversations. Users can interact through either the rendered interface or an AI agent; both methods operate on the same application state.

The AI does not generate executable application code. Instead, it explores the available capabilities and resources, then uses validated tools to configure the workspace, manipulate data, and mutate the interface.

### Primary objective

Prove that a general-purpose LLM can discover an unfamiliar application environment and use its capabilities to create and maintain functional, persistent interfaces without application-specific prompts or generated source code.

### MVP success criteria

A user can:

1. Sign in to PAW, configure an OpenAI API key, and select a supported OpenAI model.
2. Create a new PAW through natural language.
3. Watch the agent discover resources/tools and construct a usable interface.
4. Manipulate workspace data directly through the interface without model inference.
5. Modify the existing interface through a later conversation without losing data.
6. Maintain multiple conversations over the same, current workspace state.
7. Refresh the page, sign out and back in, or return from another browser session and find their workspaces, records, interfaces, and conversations preserved.

Model-agnostic architecture is an MVP requirement; fully working Anthropic/Google integrations are **not** required for the first release.

## 2. Core domain concepts

- **Workspace:** Primary persistent entity with one active mutable interface, scoped structured data, and any number of conversations. A workspace _is_ the application, not a folder of separate applications.
- **Interface:** Versioned declarative representation of the workspace UI. May contain multiple pages, tabs, or sections; remains uniquely tied to its workspace.
- **Collection:** Workspace-scoped schema for structured data.
- **Record:** Stored entry belonging to a collection.
- **Conversation:** Independent message thread within a workspace, interacting with its latest state.
- **Tool:** Discoverable capability with defined inputs, outputs, permissions, side effects, and execution behavior.
- **Resource:** Inspectable workspace/runtime object (e.g., component, collection, schema, record, or workspace metadata).
- **Action:** Validated operation triggered by either the user interface or the agent.

Workspace data is authoritative; past conversations are historical context, not the source of truth.

## 3. Functional requirements

### FR-01 — Web application and user accounts (P0)

- Build a browser-based application with **Next.js, React, and TypeScript**.
- Provide a desktop-first responsive interface that remains usable in modern browsers on other platforms.
- Use **Supabase Auth** to sign users in, restore sessions, and sign out securely.
- Ensure workspace creation, listing, and access are scoped to the authenticated user.
- Keep core workspace services and agent orchestration independent of React components and HTTP routing.
- Use authenticated server-side route handlers/server actions for protected operations; do not expose database access credentials to the browser.
- The MVP requires network connectivity; offline-first workspace access and local installations are out of scope.

### FR-02 — API credentials and model configuration (P0)

**Use standard provider API credentials, not ChatGPT subscription-backed authentication.**

- Let each signed-in user provide, validate, replace, and remove their OpenAI API key.
- Keep model requests and tool execution on the server. The browser submits the key only over HTTPS to a protected backend endpoint.
- If keys are persisted, encrypt them at rest using a server-controlled encryption key or managed secrets solution, separated from the database; keys must never be stored as plaintext, logged, included in model messages, or returned to browser application state.
- Access to a user's stored provider credentials must require that user's authenticated session and authorization checks.
- Use the standard, separately billed OpenAI API; no ChatGPT subscription entitlement is assumed or required.
- Provide model selection among supported model IDs (configured or obtained from provider APIs).
- Stream output, handle rate limits, invalid keys, network failures, and usage errors.
- Provide request cancellation and an optional per-request token/cost estimate where usage and pricing data permit.
- Allow the user to configure a soft per-account usage budget and see estimated spend for PAW-initiated requests; explain that this is **not** a provider-enforced hard spending cap.
- The settings and storage abstractions must support separate credentials and model IDs for other providers later.

### FR-03 — Provider-independent inference (P0)

- Use the **Vercel AI SDK** to normalize model invocation, streaming, and ordinary function/tool calls.
- Define an application-level `ModelProvider` / provider configuration boundary, so runtime services never import OpenAI-specific request types.
- Normalize conversation messages, tool call requests/results, stream events, usage, and recoverable errors into PAW-owned types.
- Preserve provider-specific features behind capability flags/adapters, e.g., `supportsHostedMcp`, `supportsNativeToolSearch`, and `supportsStructuredOutput`.
- Use OpenAI Responses API initially; design to add Anthropic and Google adapters without modifying workspace/data/interface tools.
- Persist conversation history in PAW-neutral form. Do not rely exclusively on provider-managed threads, response IDs, reasoning state, or proprietary session objects.
- Switching providers later may require translating conversation history and may not preserve provider-specific reasoning state. Equivalent reasoning quality or feature parity is not guaranteed.

### FR-04 — Workspace management (P0)

- Create, list, open, rename, and delete workspaces (delete requires confirmation).
- Start new workspaces with an empty or minimal interface, no application-domain template, and user-isolated storage.
- Ensure every workspace has exactly one active interface definition, with revisions tracked separately.

### FR-05 — Multiple conversations (P0)

- Create and switch among persistent conversations in a workspace.
- Store messages and user-visible significant tool events.
- Stream responses into the active conversation.
- All conversations inspect and modify the current workspace state, regardless of what existed when older messages were written.
- Conversations do not own records or interface definitions.

### FR-06 — Autonomous capability discovery (P0; critical)

An agent should explore the system rather than receive its full structure upfront.

Bootstrap tools (or equivalent operations):

| Tool               | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `search_tools`     | Search capabilities by task, intent, or keyword.                         |
| `describe_tool`    | Retrieve a selected tool's full schema and behavior.                     |
| `list_resources`   | Discover resources accessible in the current scope.                      |
| `inspect_resource` | Inspect resource metadata, schema, relationships, and supported actions. |

- Supply a minimal system instruction describing exploration, safety rules, and tool-use conventions.
- The agent chooses what to inspect and which capabilities to use.
- Tool definitions are loaded on demand rather than always included in full.
- Discoverability is supported by useful machine-readable metadata, descriptions, input/output schemas, and permissions.
- Tool discovery and execution must use the same **server-side registry** regardless of model provider.
- Paginate/bound large results; return structured errors with retryable guidance.
- Never allow returned tool descriptions or resource content to override higher-priority instructions or bypass authorization.

### FR-07 — MCP interoperability and execution (P0/P1)

**MCP is the interoperability boundary, not the persistence or UI architecture.**

**Required portable path (P0):**

- Represent PAW tools/resources using MCP-compatible descriptions and an adapter around a server-side Tool Registry.
- Have PAW's backend enumerate, discover, validate, and execute capabilities; the browser must not run tools or hold provider credentials.
- Translate discovered tools into model function calls when a provider does not support native hosted MCP or native tool search.
- Run application-managed discovery/execution against trusted PAW services, enforcing authenticated user context, workspace ownership, permissions, and confirmation policies on every call.
- Provide a minimal reliable discovery loop: search, inspect schema, invoke, process results/errors.

**Optional provider optimization (P1):**

- Support provider-native hosted MCP via an authenticated HTTPS endpoint (for example, `/api/mcp`) **when securely supported** by the selected provider/model.
- Reuse the same underlying services and tool definitions as application-managed execution; hosted MCP must not introduce a separate business-logic implementation.
- Because PAW is hosted, the endpoint can be remotely reachable; however, public reachability is **not** authorization. Use scoped, short-lived credentials bound to the user/workspace, validate each request, and protect against cross-user access.
- Apply explicit user approval where appropriate for tool side effects and provider access to workspace data.
- Hosted MCP is not a prerequisite for the MVP; application-managed tool calling remains the universal fallback.

**Future (out of scope):** External third-party MCP server installation, a general public MCP developer platform, and a tool marketplace.

### FR-08 — Workspace resource exploration (P0)

- Allow the agent to list and inspect workspace metadata, interface components, collections, field schemas, supported actions, and queryable data.
- Include semantic descriptions, relationships, and component capabilities (e.g., bound collection, editable fields, supported operations).
- Support scoped queries, sorting, filtering, aggregations, and pagination.
- Resource exploration must not require reading React source or direct database access.

### FR-09 — Persistent structured data (P0)

- Create/inspect collections and field schemas.
- Create, retrieve, update, delete, and query records.
- Support basic string, number, boolean, date, and enum fields.
- Support basic filtering, sorting, and aggregation.
- Permit supported schema edits with appropriate validation/migration behavior.
- Enforce per-user and per-workspace ownership/isolation on every read/write; use Supabase Row Level Security (RLS) where applicable and repeat authorization checks at the application-service boundary.
- Removing an interface component must **never** delete underlying records or collections implicitly.

### FR-10 — Declarative interface runtime (P0)

- Render versioned, validated JSON-like interface definitions using React.
- Initial components: layout/container, text, heading, button, input/form, table, list/card, chart, and tabs.
- Support stable component IDs, nested layouts, properties, data bindings, and declarative actions.
- Use a known trusted component registry; generated interfaces cannot include arbitrary executable code.
- Evaluate existing standards/renderers such as A2UI; use an adapter when helpful, but PAW retains control of its persistence, schema versions, bindings, and actions.

### FR-11 — Agent-driven interface mutations (P0)

- Agent can inspect the current interface and add, remove, move, and reconfigure supported components.
- Mutations target stable component IDs; full regeneration is not necessary.
- Validate schemas, bindings, action references, and permissions before commit.
- Require an expected interface revision or equivalent concurrency guard.
- Save a new revision atomically; failed mutations leave the last valid interface intact.
- Coordinate related schema/record/interface mutations transactionally when possible, or use recoverable steps with explicit failure handling.

### FR-12 — Direct UI interactions and actions (P0)

- Users can submit forms, create/edit records, sort/filter tables, navigate tabs, and trigger supported actions without the LLM.
- UI actions and agent tool calls both invoke the same trusted application services.
- Deterministic actions include read/query, create/update/delete record, local UI state mutation, and navigation.
- Destructive operations require confirmation.
- No arbitrary JavaScript, SQL, shell commands, or AI-generated React execution in the MVP.

### FR-13 — Persistence, history, and recovery (P0)

- Store workspace data, interface definitions/revisions, conversations, and operation history in **Supabase PostgreSQL**.
- Scope stored resources to authenticated accounts and their workspaces.
- Retain workspace state across page reloads, logins, browser sessions, and deployments.
- Use PostgreSQL transactions, operation logs, and revision checks to prevent lost updates.
- Offer rollback to the previous valid interface revision.
- Recover from invalid agent responses, cancelled requests, connection interruptions, and server restarts without corrupting workspace state.
- Full event sourcing is not required.

### FR-14 — Agent activity visibility (P1)

- Display meaningful discovery, inspection, mutation, and execution events.
- Show confirmations for destructive actions and comprehensible failures.
- Do not expose hidden model reasoning, credentials, or private internal context.

## 4. Agent and execution architecture

```text
Web Client (Next.js + React)
  ├── Workspace UI (declarative renderer)
  ├── Conversations and streaming tool activity
  └── Account settings: provider, model, API key, usage
                  │ HTTPS / streaming
                  ▼
Next.js Server (authenticated route handlers)
  ├── Session/authorization enforcement
  ├── AgentOrchestrator (provider-neutral)
  │     ├── ModelProvider / Vercel AI SDK adapters
  │     │     ├── OpenAI Responses API (initial)
  │     │     ├── Anthropic (future)
  │     │     └── Google (future)
  │     ├── Conversation state / context
  │     ├── ToolRegistry + discovery
  │     └── ToolExecutor / MCP adapters
  │           ├── Application-managed tool execution (P0)
  │           └── Hosted MCP endpoint (optional P1)
  └── PAW Core Services
        ├── WorkspaceService
        ├── DataService
        ├── InterfaceService
        └── ActionService
                  │
                  ▼
Supabase PostgreSQL + Auth
  ├── User-scoped workspaces, data, interfaces
  ├── Conversations, messages, operations, revisions
  └── Encrypted provider credential references/data
```

The web client renders and dispatches normal UI actions. All provider credentials, model calls, tool discovery/execution, persistence mutations, and authorization checks remain on the server. The MCP endpoint is an optional server adapter, not a replacement for the agent orchestrator or core services.

### 4.1 Agent orchestration

1. Resolve provider and model from the current user settings.
2. Load relevant conversation history and minimal system/tool-discovery guidance.
3. Present bootstrap tools or supported provider-native discovery facility.
4. Receive tool requests and resolve their tool specifications.
5. Validate permissions, arguments, and execution safety.
6. Execute against PAW Core through server-side application services, returning bounded structured results.
7. Continue inference until a completed response, cancellation, or configured iteration limit.
8. Persist normalized conversation and operation records.

### 4.2 Tool Registry and Executor

A tool definition should include `name`, `description`, `inputSchema`, `outputSchema`, `sideEffects`, `requiredPermissions`, and `handler`.

The registry handles discoverability. The executor validates permissions and performs operations through core services; it does not trust model requests by default.

### 4.3 Model-provider boundary

The provider layer should expose model selection, streaming messages, normalized function/tool calls, usage events, errors, and provider capability flags. Provider-specific hosted tools remain optional enhancements rather than dependencies of the workspace runtime.

### 4.4 Context management

Keep the bootstrap prompt small. Give the agent capability discovery and workspace exploration rather than preloading all collection schemas or interface definitions. Authoritative state comes from runtime inspection; conversation history only provides conversational context.

## 5. Technical stack and repository

| Area                        | Initial choice                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Web application             | Next.js (App Router) + React + TypeScript                                             |
| Server/API                  | Next.js server route handlers / server-side services (Node.js runtime where required) |
| User authentication         | Supabase Auth                                                                         |
| Persistent database         | Supabase PostgreSQL, with RLS                                                         |
| Optional file storage       | Supabase Storage (only if files enter MVP scope)                                      |
| Model abstraction           | Vercel AI SDK                                                                         |
| First model provider        | OpenAI Responses API (per-user API key)                                               |
| Tool interoperability       | MCP TypeScript SDK / compatible adapters                                              |
| Validation                  | Zod + JSON Schema                                                                     |
| UI rendering                | Trusted declarative React component registry; evaluate A2UI                           |
| Client/server communication | Authenticated HTTPS endpoints and streaming responses                                 |
| Deployment                  | Hosted Next.js web app + Supabase project; maintain local development environment     |

```text
paw/
├── apps/web/
│   ├── app/                 # Thin Next.js route/page entrypoints
│   └── src/
│       ├── features/        # Auth, Workspaces, Collections, Interfaces,
│       │                    # Chat, Agent, Providers, Tooling
│       ├── composition/     # Authenticated runtime and registry assembly
│       └── shared/          # Neutral database/HTTP/UI primitives
├── tests/                   # Unit contracts, integration, browser workflows
├── scripts/
└── supabase/migrations/     # Existing deployment schema and RLS
```

See [docs/architecture.md](docs/architecture.md) for current feature ownership, public contracts, and dependency boundaries. The product requirements below retain their milestone history.

Initial tables: `workspaces`, `collections`, `records`, `conversations`, `messages`, `operations`, `interface_revisions`, and optionally `provider_credentials` (encrypted). Use Supabase Auth's managed users rather than duplicating identity records unnecessarily. Each workspace is owned by an authenticated user; use `user_id`/`workspace_id` scoping, appropriate foreign keys, and RLS policies.

Serverless/hosting limits may affect long-running agent loops and streaming requests. For the MVP, use bounded model iterations and select a deployment runtime with suitable request durations; move orchestration to a dedicated worker/server only if those constraints become material.

## 6. Security and privacy requirements (P0)

- Authenticate browser requests with Supabase Auth and enforce authorization on every backend operation, not solely through the UI.
- Enforce workspace ownership using RLS policies and server-side checks; prevent cross-account access through record IDs, resource inspection, and tool execution.
- Keep provider API keys and model calls on the server. Never include credentials in model context, client bundles, logs, response payloads, or browser storage.
- If storing user-provided keys, encrypt them at rest with a server-controlled key or managed secrets service; secure access and key rotation procedures are required.
- Use HTTPS and appropriately secured session cookies/tokens; apply CSRF protection where required for the chosen auth mechanism.
- Do not expose a Supabase service-role key or other administrative secrets to the client.
- Validate every tool request, action, and declarative interface definition; enforce rate limits and request-size limits.
- Treat model responses, user-provided content, and external MCP resources as untrusted; defend against prompt injection.
- Require confirmation for destructive operations and retain visible mutation history.
- Disallow arbitrary generated source code, shell commands, direct SQL, and filesystem execution through agent tools.
- Set model iteration limits, timeouts, and bounded tool-result sizes; prevent runaway inference costs.
- Protect hosted `/api/mcp` with explicit authorization, limited privileges, and scoped tokens if enabled later; remote visibility alone never grants access.

## 7. Required end-to-end demonstrations

### Scenario A — Create a movie tracker

User: "Create a workspace for movies I've watched and rate them out of ten."

The agent discovers capabilities, creates a collection, assembles a table/form interface, and the user adds ratings through the UI. Data survives page refresh and returning after sign-in. No movie-specific template is hardcoded.

### Scenario B — Evolve its interface

User: "Add a chart showing the distribution of my ratings."

The agent explores the existing interface and collection, discovers a chart capability, inserts a bound chart, and preserves all existing records. Future UI edits automatically affect chart results.

### Scenario C — Two conversations, one workspace

A second conversation changes the layout. The first conversation remains available and operates on the latest workspace data/interface on its next turn.

### Scenario D — UI edits without inference

The user changes a rating in the interface; the database and chart update without an LLM call. The agent later queries the current collection and reports the correct average.

### Scenario E — Invalid operation recovery

The model requests an unsupported component; validation rejects it without corrupting state. The agent inspects the error, discovers a supported option, and retries.

### Scenario F — API/provider failure

An invalid key, budget warning, rate limit, or interrupted inference produces a comprehensible error. Persisted workspaces and their interfaces remain accessible through PAW even if inference fails. Provider settings can be corrected without losing state.

### Scenario G — Provider-neutral tool contract

A test harness or stubbed second provider uses the same tool registry, exploration protocol, and workspace operations without changes to the core runtime. This verifies model-agnostic architecture without shipping a second live provider in the MVP.

### Scenario H — Account isolation and persistence

Two users sign in to separate accounts. Each user can create and operate their own workspaces, but cannot discover, query, or modify the other account's resources through the UI, API, or agent tools. The first user signs out and later signs back in from another browser and recovers the same saved workspace state.

## 8. Non-functional requirements

- Ordinary UI interaction must not wait for model inference, though writes require normal backend requests.
- Hundreds of records should remain responsive; pagination and bounded queries should prevent runaway context sizes.
- Stream model output over HTTP and allow cancellation; handle connection drops and hosting timeouts gracefully.
- Test PAW Core, tool registry, and executor without launching a browser or calling a live LLM.
- Database/schema migrations must preserve saved workspaces across application deployments.
- User data must remain scoped to the account and exportable in a future iteration; browser-local persistence is not the source of truth.
- Provider/model identity should be recorded with each assistant response for debugging without embedding proprietary provider state as the source of truth.
- Core interface functionality should work in mainstream modern browsers; the initial UX is optimized for desktop screen sizes.

## 9. Explicitly out of scope

- Sign in with ChatGPT / ChatGPT subscription-backed inference.
- Production Anthropic, Google, or local-model integrations (provider adapters only).
- Offline-first operation, local SQLite storage, Electron, or packaged desktop applications.
- Multi-user collaboration, real-time sharing, and public workspace publishing.
- External third-party MCP server installation or a plugin marketplace.
- Hosted MCP integration as a requirement for core functionality (optional P1 only).
- Arbitrary generated React components or executable code.
- Scheduled autonomous background agents.
- Cross-workspace linked data, vector-memory systems, advanced semantic retrieval.
- Complex version-control/event-sourcing platform.
- Native mobile apps (responsive mobile layouts may be added later).

## 10. Implementation milestones

### Milestone 1 — Web app and persistent runtime

Set up Next.js, Supabase Auth/PostgreSQL, migrations/RLS, workspace CRUD, collection/record services, interface schemas, and deterministic React rendering. **Exit:** A signed-in user can create a manually configured workspace, use its UI, refresh, and find data preserved. A different account cannot access it.

### Milestone 2 — Discoverable tool system

Build the server-side registry, discovery tools, inspectable resources, executor, and MCP-compatible adapter. **Exit:** A test agent/client discovers capabilities and changes an authorized workspace without private service access; cross-workspace access is rejected.

### Milestone 3 — OpenAI API + provider boundary

Implement secure per-user API-key configuration, Vercel AI SDK integration, Responses API inference, streaming, conversation persistence, and server-managed tool orchestration. **Exit:** OpenAI independently discovers and uses PAW tools, and a mocked second provider passes the same contract tests.

### Milestone 4 — Agent-driven interface evolution

Wire up interface mutations, data bindings, schema changes, and direct UI actions. **Exit:** Scenarios A–E pass without domain-specific templates.

### Milestone 5 — Security, resilience, and deployment

Complete authorization/RLS tests, encrypted secrets handling, operation logs, revision safety, confirmation policies, failure recovery, rate limits, and hosting configuration. **Exit:** Scenarios A–H pass on a deployed web application and in local development.

### Optional follow-on — Provider-native hosted MCP

Expose a scoped, authenticated HTTPS MCP endpoint and test native provider-hosted discovery/execution. Reuse the tool registry/core services; keep the application-managed tool path as fallback.

## 11. Definition of done

The MVP is complete when an authenticated user can open PAW in a browser, configure an OpenAI API key, create a workspace, have the model independently discover the environment and construct a functional interface, manipulate its data directly, evolve the interface through multiple conversations, and recover the same user-isolated workspace state after refreshing or signing in again.

**Core principle:** The runtime owns state and enforces rules. MCP-compatible tools expose capabilities. The agent explores and operates the system. The selected model provider is replaceable.

## 12. Reference documentation

- [OpenAI API: Remote MCP tools](https://platform.openai.com/docs/guides/tools-remote-mcp)
- [Vercel AI SDK: Providers](https://ai-sdk.dev/docs/getting-started/choosing-a-provider)
- [Vercel AI SDK: MCP tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
- [MCP specification](https://modelcontextprotocol.io/)
- [A2UI](https://a2ui.org/)
