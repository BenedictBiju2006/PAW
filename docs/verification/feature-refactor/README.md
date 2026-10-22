# Feature refactor verification

Baseline: `f8d7488` (same tree as `007338b`). Before modifications, typecheck, all 42 unit tests, production build, 24 integration tests, and all 7 browser tests passed. The dependency scan covered 42 source modules and found no runtime import cycles.

The existing browser visual audit captured 390, 768, 1024, 1440, and 1920px viewports, including Chat, empty/populated/expanded Interface, conversation drawer, tool activity, AI settings, and Developer Tools. Representative baseline screenshots were visually inspected and are retained in `before/`; the complete baseline run is in ignored `work/refactor/before/`.

First checkpoint: feature-owned workspace/collection/interface services, provider modules, generic tooling, domain registrations, and decomposed Workspace/Auth UI pass typecheck, all 42 unit tests, and production build. The A2UI protocol workspace retains its original pinned dependencies and isolated Zod 3; application schemas remain on Zod 4.
