# Working on PAW

Read `README.md`, `requirements.md`, and `docs/architecture.md` before changing behavior. For Next.js work, also follow `apps/web/AGENTS.md` and read the relevant installed guides under `node_modules/next/dist/docs`.

- Application features live in `apps/web/src/features`. Keep frontend, validation, server operations, HTTP handlers, and domain tools with their owning feature.
- Use explicit `public.ts` (client-safe contracts), `client.ts` (browser UI), and `server/public.ts` exports across feature boundaries. Do not add catch-all barrels or reach into another feature's internals.
- Server implementations use `import "server-only"`. Credentials, inference, privileged persistence, and database mutations never belong in client imports.
- `src/composition` assembles services, the authoritative registry, resource relationships, concrete providers, and HTTP routing. `src/shared` is only for domain-neutral infrastructure; it must not import features.
- Tooling stays generic. Register domain tools in the owning feature's `server/tools.ts`, then assemble them in `composition/tools.ts`. Preserve strict validation, ownership, permissions, trusted confirmations, and discovery-first execution.
- Interfaces owns the official A2UI v0.9.1 implementation. Its nested `protocol` npm workspace intentionally retains Zod 3 for the official package; application/tool schemas use Zod 4. Do not flatten this dependency boundary.
- Preserve API paths, credential encryption formats, persisted activity, model defaults, exact Google replay/signatures, cancellation, and live mutation invalidation. Keep Chat mounted when switching primary views.
- Never edit applied Supabase migrations for a source reorganization. A genuine schema change requires a new forward-only migration and tests.
- Styles belong in feature `styles/` directories. `app/globals.css` controls import order; shared tokens and UI primitives remain centralized. Preserve the monochrome appearance and responsive height/scroll chain.

Run `npm run test:architecture`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:integration`, and `npm run test:browser`. The last two use disposable Docker backends; never substitute hosted credentials. Unit/integration runners intentionally enable Node's `react-server` condition for server-only modules. No live paid inference is part of these checks.

`tests/tool-contract-baseline.json` records all 22 tools before the architecture refactor. Do not regenerate it to conceal a refactor regression; intentional public contract changes need explicit review. Preserve existing tests and add meaningful coverage for changed boundaries. Capture and inspect real desktop/mobile screenshots for layout changes.
