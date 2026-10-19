# PAW

Persistent Agentic Workspaces. Milestone 1 implements a Next.js application with Supabase email/password authentication, private workspaces, typed collections and records, and a saved declarative interface. AI conversation and tool discovery belong to later milestones.

## Run the app

Requires Node.js 22 or newer (validated with Node 24) and npm. Use the existing checkout; a separate Git worktree is unnecessary.

```sh
npm ci
cp apps/web/.env.example apps/web/.env.local
# Set the project URL and publishable key in .env.local.
npm run dev
```

The two connection variables are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. A legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted. They are resolved by the server at runtime. No service-role key, database password, or OpenAI key is needed to run Milestone 1. Never put privileged Supabase credentials in a public environment variable or commit `.env.local`.

For production, set these variables on the Next.js host, then run `npm run build` and `npm start`. Use HTTPS. When running behind a reverse proxy, set `PAW_APP_ORIGIN` to the public app origin (scheme and hostname, without a trailing slash) so origin checks use the external URL. The app uses HTTP-only, SameSite=Lax cookies, with Secure cookies in production. Every API request validates the user with Supabase Auth; mutation requests also require a matching Origin header. Browser auth/data operations go through server endpoints.

## Supabase project setup (required once)

Connecting a repository to Supabase does **not by itself confirm that database migrations have run**. There are two supported ways to apply the migration:

1. In your Supabase project, open **SQL Editor**, create a new query, paste the complete contents of [`supabase/migrations/202610200001_milestone_one.sql`](supabase/migrations/202610200001_milestone_one.sql), and run it once against a fresh PAW schema. The migration creates the four Milestone 1 tables, their indexes, validation triggers, revision capture, and row-level security policies.
2. If your project uses the Supabase CLI migration workflow, authenticate the CLI, link the project, inspect the pending changes, and push migrations:

   ```sh
   supabase init  # Generate CLI configuration if not initialized yet
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push --dry-run
   supabase db push
   ```

Use a recent Supabase CLI. Database authentication stays in your local secure CLI flow. If you apply SQL manually and later adopt CLI migrations, reconcile migration history with `supabase migration repair` before pushing; do not run the initial SQL twice. Do not apply `tests/*bootstrap.sql` or `tests/auth-claims.sql` to a hosted project: those files create disposable local test backends only.

In Supabase **Authentication → Sign In / Providers**, enable Email. In **Authentication → URL Configuration**, set the Site URL to the app's URL and allow the development/deployment URLs you use. Email confirmation is supported: create an account, follow the confirmation email, then return to PAW and sign in. Leave email confirmation enabled for production. Configure your production SMTP sender before inviting real users. Password recovery and social login are outside this milestone.

No storage bucket or realtime configuration is needed. No application tables are accessible anonymously. The application deliberately uses each signed-in user's scoped token and never uses a service-role bypass.

## Manually configure a workspace

1. Sign up or sign in, then create a workspace. A new workspace starts with an empty interface.
2. Open **Collections & data → New collection**. Define field labels and keys, their types, required flags, and enum options. Field types are string, number, boolean, date, and enum. Schemas are immutable in this milestone so existing records cannot be invalidated by a field edit.
3. Add records, edit existing records, and use exact-match filters, typed sorting, and pagination (25 per page). Deletion requires confirmation. Updates use the last-read timestamp to reject stale edits.
4. Open **Interface builder**. Add a heading, or use a collection's **form & table** shortcut. Save the interface and return to **Workspace** to use it. A form's inputs are generated from its collection schema.
5. Reload the app or sign out and back in. Workspaces, records, and the interface are stored in PostgreSQL. The current workspace is kept in the URL and reopens after reload.

The JSON editor supports this versioned component contract:

```json
{
  "version": 1,
  "nodes": [
    { "id": "intro", "type": "heading", "text": "My workspace" },
    { "id": "description", "type": "text", "text": "A place for my records." },
    { "id": "entry", "type": "form", "collectionId": "COLLECTION_UUID" },
    { "id": "items", "type": "table", "collectionId": "COLLECTION_UUID" }
  ]
}
```

Replace `COLLECTION_UUID` with the ID shown in the collection schema panel. Supported components are `heading`, `text`, `container`, `tabs`, `button`, `form`, `table`, `list`, and `chart`. Containers and tabs accept `children`; tab labels use each child's `text` or ID. Charts require `collectionId` and a `field` key, and display value counts over the entire collection, limited to the 100 most frequent distinct values. Numeric aggregates (sum, average, min, max) are available through the core service. Buttons refresh workspace data. Arbitrary URLs, HTML, scripts, event handlers, and generated code are not accepted.

Stable IDs must be unique. Definitions are capped at 200 components and eight nesting levels. Bindings may only reference collections and fields in the same workspace. Every save checks the expected revision; a stale session must reload before saving. **Revision history** restores a previous definition as a new revision. Interface changes never delete collection records.

A2UI was considered as specified in the requirements. Milestone 1 uses PAW's small, closed JSON contract to keep validation and persistence explicit without an additional renderer dependency. A later adapter can translate this contract without changing the storage boundary.

## Layout and API

- `apps/web`: Next.js App Router, authenticated route handlers, responsive UI, and the deterministic React renderer.
- `packages/core/schema.ts`: shared validated collection, record, interface, and binding contracts.
- `packages/core/services.ts`: route-independent workspace/data/interface services, explicit ownership checks, user-scoped Supabase access.
- `supabase/migrations`: PostgreSQL schema, composite scope foreign keys, RLS, database-side validation, immutable revision history, and aggregation.

Endpoints under `/api`:

| Path                                                            | Methods            | Purpose                             |
| --------------------------------------------------------------- | ------------------ | ----------------------------------- |
| `/auth/signup`, `/auth/signin`, `/auth/signout`                 | POST               | Cookie-backed authentication        |
| `/auth/session`                                                 | GET                | Current authenticated identity      |
| `/workspaces`                                                   | GET, POST          | List/create workspaces              |
| `/workspaces/:id`                                               | GET, PATCH, DELETE | Load/rename/delete workspace        |
| `/workspaces/:id/collections`                                   | GET, POST          | Inspect/create collections          |
| `/workspaces/:id/collections/:collectionId`                     | GET, POST          | Query/create records                |
| `/workspaces/:id/collections/:collectionId/:recordId`           | PATCH, DELETE      | Edit/delete record                  |
| `/workspaces/:id/collections/:collectionId/aggregate?field=key` | GET                | Value counts and numeric aggregates |
| `/workspaces/:id/interface`                                     | PUT                | Save `{definition, revision}`       |
| `/workspaces/:id/revisions`                                     | GET                | Latest 20 interface revisions       |

Record writes accept `{data}`; edits additionally require `updatedAt` from the previously read record. Destructive requests require `{confirmed: true}`. Record queries accept `offset`, `limit` (1–100), `sort` (field key), `direction` (`asc`/`desc`), `filter` (field key), and `value` (exact typed value). The server does not accept caller-supplied ownership or SQL expressions.

## Validation

```sh
npm test                 # Core validation contracts
npm run typecheck
npm run build
npm run test:integration # Requires Docker; isolated Postgres + PostgREST
npm run test:browser     # Requires Docker, a production build, and Chromium
```

Browser tests use `/usr/bin/chromium`; set `CHROMIUM_PATH` for another installed Chromium executable. If system Chromium is unavailable, run `npx playwright install chromium`; the tests fall back to Playwright’s managed browser. The browser test owns port 3100 temporarily; stop other processes using that port first.

The integration runner starts disposable PostgreSQL 17 and PostgREST containers, applies the actual migration, and exercises services with separate user JWTs. It tests persistence through a new client, RLS reads and writes, invalid direct writes, scope constraints, pagination and numeric sorting, revision transactions, data-preserving interface rollback, stale record updates, aggregation, and deletion cascades.

The browser runner adds the real Supabase Auth (GoTrue) service and a test-only local gateway. It validates account creation, HTTP-only cookies, workspace/collection/record creation, interface rendering, record edits, page reload, sign-out/sign-in persistence, a second isolated account, CSRF rejection, and desktop/mobile rendering. Email is auto-confirmed **only in this disposable local backend**. Neither runner uses your hosted project or changes your production Auth settings. Containers and test databases are removed on exit.

## Hosted acceptance check

After applying the migration and starting the app with your hosted connection settings:

1. Sign in as account A, create a workspace and collection, add a record, and save a form/table interface.
2. Use the rendered form and edit a table record. Reload, reopen the workspace, and verify the same data and interface.
3. Sign out, sign back in, and verify persistence.
4. Open an incognito browser as account B. Account A's workspace must not appear. Requests for A's workspace ID must return 404.

The repository's Supabase connection and the hosted migration deployment must be checked in your project; local validation does not establish that your hosted schema has been migrated. Agent conversations, model keys, tool discovery, and agent-driven mutations are intentionally deferred to Milestones 2–4.
