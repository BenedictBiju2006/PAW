# Feature refactor verification

Baseline: `f8d7488` (same tree as `007338b`). Before source changes, typecheck, all 42 unit tests, production build, 24 integration tests, and all 7 browser tests passed. There were no baseline failures. The initial dependency scan covered 42 source modules and found no runtime import cycles.

## Final checks

| Command                                       | Result                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run test:architecture`                   | Passed: 119 modules, 35 client roots; no runtime cycles, private cross-feature imports, or client/server leaks |
| `npm run typecheck`                           | Passed                                                                                                         |
| `npm test`                                    | Passed: 45 tests, 0 failures/skips                                                                             |
| `npm run build`                               | Passed: production Webpack build                                                                               |
| `npm run test:integration`                    | Passed: 24 tests, 0 failures/skips, disposable Postgres/PostgREST                                              |
| `npm run test:browser`                        | Passed: all 7 tests, including five viewport audits and explicit per-conversation draft retention              |
| `npm ci --ignore-scripts --dry-run --offline` | Passed: lockfile validation                                                                                    |
| `git diff --check`                            | Passed                                                                                                         |

The final backend integration run exercises the split services and injected scope policy. The final production build/browser run also includes the WorkspaceShell extraction. No live paid inference or hosted database operation was performed.

The unit suite preserves OpenAI/Gemini/Groq SDK wire coverage, including initial versus replay failure diagnostics, finite Google tool declarations, parallel call ordering, exact argument replay, late thought signatures, authoritative validation, cancellation and idempotency. New architectural tests compare all 22 tool definitions against the pre-refactor schemas/metadata/permissions/result descriptions, verify exact scope-denial responses, and enforce dependency boundaries.

Integration coverage retains authentication/RLS, workspace ownership, CRUD/query/aggregation, legacy A2UI conversion, immutable history, revision conflicts, trusted agent persistence, destructive confirmations, credential compatibility/isolation, and a discovery-driven multi-conversation workflow. Browser tests retain native streaming, safe Markdown, real tool activity, live interface invalidation, reload persistence, account isolation, and manual Developer Tools workflows.

## Rendered visual audit

The same Playwright audit captured **67 before/after screenshot pairs** at **390, 768, 1024, 1440, and 1920px**, covering short/long conversations, expanded tool activity, empty/populated/expanded A2UI interfaces, narrow-table actions, conversation navigation, provider/model selection, AI Settings (including bottom controls), and both Developer Tools views. Mobile also uses a reduced 560px-high viewport.

Actual images were inspected for clipped content, overlap, composer accessibility, drawer displacement, cramped panes, misalignment and page overflow. The existing geometry assertions also passed. Representative final screenshots:

| State                                   | Screenshot                                       |
| --------------------------------------- | ------------------------------------------------ |
| Mobile Chat                             | [390px](after/mobile-chat.png)                   |
| Expanded tablet Interface               | [768px](after/tablet-interface.png)              |
| Laptop long conversation/tool details   | [1024px](after/laptop-tools.png)                 |
| Desktop Chat + populated Interface      | [1440px](after/desktop-split.png)                |
| Wide Developer Tools / official builder | [1920px](after/wide-developer-tools.png)         |
| Mobile conversation drawer              | [390px drawer](after/mobile-conversations.png)   |
| AI Settings                             | [1440px settings](after/desktop-ai-settings.png) |
| Reduced-height mobile composer          | [390 × 560px](after/mobile-short-viewport.png)   |

The [baseline mobile](before/mobile.png) and [baseline desktop](before/desktop.png) images are retained. [Pixel comparison measurements](visual-differences.json) compare all 67 pairs without masking dynamic data (channel difference threshold 16). The largest changed-pixel fraction is **0.536%**, concentrated in dynamic workspace IDs, test account addresses and builder loading text. Primary mobile Chat and the populated desktop layout match their baseline appearance. These measurements supplement visual inspection; they are not a substitute for checking the rendered pages. Full runs remain in ignored `work/refactor/before` and `work/refactor/after`.

## Incremental checkpoints and corrections

1. Feature service/provider/tool relocation and Workspace/Auth decomposition: typecheck, all 42 original unit tests, and build passed.
2. Chat/collection component extraction and feature HTTP delegation: typecheck, all 42 original unit tests, and build passed.
3. Agent collaborators, styles, contracts and guards: subsequent unit, integration and browser checks run as listed above. Integration caught two omitted registrations (`rename_workspace`, `list_collections`); both were restored and the complete pre-refactor tool-contract fixture now prevents recurrence. A build caught a misplaced client directive, corrected before visual verification. The added draft assertion was corrected to explicitly seed distinct drafts in two conversations.

No system prompt, model defaults, provider billing/validation policy, encryption format, public API path, RLS boundary, stored activity format, or Supabase migration was changed. Existing databases require no migration for this refactor. Draft preservation uses workspace-scoped memory only. Remaining architectural/runtime constraints are documented in [architecture.md](../../architecture.md).
