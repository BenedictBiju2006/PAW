# PAW — Persistent Agentic Workspaces

**Turn conversations into persistent, interactive workspaces.**

PAW is an experimental full-stack application where AI agents can discover available tools, organize structured data, and build usable interfaces through conversation. Unlike a conventional chatbot, each workspace has durable data, a configurable interface, and multiple conversations that operate on the same state.


## Features

- **Agent-built interfaces:** Create and update forms, tables, charts, and layouts using validated [A2UI](https://a2ui.org/) components rather than generated executable code.
- **Persistent workspaces:** Store structured collections, records, and interface revisions in Supabase, independently of chat history.
- **Discoverable tools:** Agents search for capabilities and inspect tool schemas on demand instead of receiving every tool definition upfront.
- **Multi-provider AI:** Stream responses through OpenAI, Google Gemini, or Groq using user-configured API credentials.
- **Controlled execution:** Validate tool arguments and workspace permissions, enforce execution limits, and require trusted approval for destructive actions.
- **Workspace conversations:** Maintain multiple chat threads within a shared workspace, alongside a live interactive interface.

## Tech stack

**TypeScript · Next.js · React · Supabase (PostgreSQL, Auth, RLS) · Vercel AI SDK · Model Context Protocol (MCP) · A2UI · Zod · Playwright**

The application uses a feature-based codebase with isolated responsibilities for workspaces, collections, interfaces, chat, inference providers, and tool execution.

## Run locally

Requires Node.js 24, npm, and a configured Supabase project.

```bash
npm ci
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env.local`. The UI runs at `http://localhost:3000`.

**Database setup:** PAW requires the database schema and migrations under `supabase/migrations`. A historical conversations migration is not currently included in the repository, so a fresh Supabase project requires that migration to be recovered before all features can run. See the migration history in the source and do not apply test fixtures to a hosted database.

For AI features, configure the server-only Supabase credential and `PAW_CREDENTIAL_ENCRYPTION_KEY` as described in `apps/web/.env.example`, then add your model-provider API key through AI settings. API usage may incur provider charges.

## Tests

```bash
npm run typecheck
npm test
npm run test:architecture
npm run build
```

Integration and browser suites are available through `npm run test:integration` and `npm run test:browser` (Docker required).

---

**Status:** Active personal project / prototype. PAW explores how general-purpose AI models can assemble useful software workflows from a constrained, reusable set of tools and UI components.
