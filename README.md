# PAW

Persistent Agentic Workspaces. Milestone 1.5 adds **A2UI v0.9.1** to the existing Next.js/Supabase runtime and replaces the decorative frontend with Ranked's restrained black-and-white design language. Authentication, private workspaces, typed collections, record operations, and revision history remain supported. LLMs, conversations, MCP, and agent tool discovery are later milestones.

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

**If Milestone 1 is already installed**, apply only the new forward migration:

[`supabase/migrations/202610200002_a2ui.sql`](supabase/migrations/202610200002_a2ui.sql)

In the Supabase dashboard, open **SQL Editor**, paste that entire file into a new query, and run it once. Apply it before using this app version. The original `202610200001_milestone_one.sql` is unchanged and must not be rerun on an existing installation.

For a fresh project, apply both migration files in filename order. Alternatively, use the Supabase CLI's normal migration flow:

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

`WorkspaceService.inspect()`, `catalog()`, `saveInterface()`, and `applyInterfaceMessages()` are reusable by future authorized tools. No LLM or MCP layer is implemented.

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
