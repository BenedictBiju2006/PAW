# Gemini compatibility and MVP layout verification

Implementation: `b84f449`, based on current main `fa4bc99`.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 31 passed |
| `npm run build` | Passed |
| `npm run test:integration` | 24 passed |
| `npm run test:browser` | 7 passed, including five viewport audits |

## Rendered visual inspection

67 Playwright screenshots were captured and inspected using actual rendered local
pages, real disposable authentication/persistence, and the official A2UI renderer.
Provider inference is mocked; no live API keys or paid inference are used.

| Width | Primary layout | Screenshots of all states |
| --- | --- | --- |
| 390px | Chat/Interface switch | [Contact sheet](contact-390.png) |
| 768px | Chat/Interface switch | [Contact sheet](contact-768.png) |
| 1024px | Chat/Interface switch | [Contact sheet](contact-1024.png) |
| 1440px | Side-by-side Chat + Interface | [Contact sheet](contact-1440.png) |
| 1920px | Side-by-side Chat + Interface | [Contact sheet](contact-1920.png) |

[All 67 original screenshots](screenshots.zip) ·
[Mobile table actions](mobile-table-actions.png) ·
[Expanded desktop Interface](expanded-desktop.png)

Every width covers short/long conversations, expanded tool activity, empty and
populated interfaces, conversation navigation, provider/model selection, AI
Settings (including bottom actions), and both expanded Developer Tools views.

Visual defects found and fixed:

- Replaced conflicting Chat heights and minimum heights with one viewport-to-pane
  flex/grid chain. Messages and Interface content scroll independently.
- Moved the desktop split to 1280px; tablet and laptop layouts use a clear switch.
- Restored an overlay conversation drawer with a close button and Escape handling,
  preserving composer/message geometry.
- Made Interface a size container, with expand/restore controls. Forms, toolbars,
  charts and tables respond to the pane width. Narrow tables become labelled rows
  so record actions remain visible without horizontal scrolling.
- Contained the narrow table's visually hidden header to prevent document overflow.
- Added visible primary navigation active states and kept Developer Tools collapsed
  by default, with a separate scroll area when opened.

Final screenshots show no document overflow, displaced composer, overlapping
navigation, or cramped split at tablet/laptop widths. Long content intentionally
scrolls inside the message log, Interface, settings dialog, and developer section.
The 390 × 560 screenshot checks reduced available height for keyboard space.

Browser regressions also verify drafts through view switches and Interface
expansion, streamed text and live mutation refresh while Chat is hidden, and
existing manual CRUD, validation, preview, revisions, authentication and isolation.

## Gemini compatibility

The new defaults are the verified stable, function-capable IDs
[`gemini-3.8-flash`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
and [`gemini-3.5-flash-lite`](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
Existing stored selections and encrypted credentials are unchanged. A saved 2.5
model remains available for existing projects unless excluded by the explicit
`PAW_GOOGLE_MODELS` override. Replacement models reuse the saved key.

Metadata validation explicitly returns `inferenceVerified: false` and never makes
an inference request. Tests distinguish missing models, project restrictions,
invalid keys, unsupported tools, rate limits and outages. Failed validation retains
the previous model/key; there is no automatic provider/model fallback.

The shared agent, main-branch prompt, tool protocol, authorization, persistence and
official A2UI runtime are unchanged. No production migrations were changed or run.
The already-applied conversations schema is supplied only as a disposable-test
fixture because its migration file is absent from current main.

## Reproduce and limits

Run the five commands above. The browser runner writes individual screenshots to
ignored `work/visual/` (or `PAW_VISUAL_OUTPUT_DIR`). It accepts Playwright arguments,
for example `npm run test:browser -- tests/browser/layout.spec.ts`.

These checks do not establish live Gemini account eligibility, quota or availability.
The reduced-height check is not a physical iOS/Android keyboard test.
