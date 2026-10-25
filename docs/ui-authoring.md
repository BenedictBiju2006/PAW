# Discovery-driven UI authoring

The authoring tools translate a short-lived batch request into official A2UI v0.9.1 messages. The saved definition, renderer, catalog, permissions, collection validators and compare-and-swap revision checks are unchanged. No migration or new dependency is required.

## Agent workflow

1. `search_tools` finds UI authoring capabilities. As with every domain capability, call `describe_tool` before using `invoke_tool`.
2. Invoke `search_ui_components` with a use case such as `movie heading editable table form chart`. Results contain concise descriptions, catalog-derived required properties, use cases and example properties. Set `component` to an exact type for its detailed schema and a minimal batch example. Existing `inspect_component` retains its JSON schema fields and adds an `x-paw-authoring` annotation with examples.
3. Inspect the workspace interface for its current revision, and the existing collection for its ID and field keys. `inspect_resource` reads existing resources; it does not replace component discovery or `describe_tool`.
4. Invoke `add_ui_components` once for the whole batch. Its result includes generated IDs, local-key mappings, surface ID and the new revision. The standard executor's `ok`/`error` envelope confirms success or failure.
5. Use `update_ui_component` for property patches and placement changes. Raw `save_interface` and `apply_interface_messages` remain available for advanced protocol authoring.

## Movie benchmark: one authoring invocation

Replace the sample workspace/collection UUIDs and revision with current authorized values. `rating` must be an existing Movies field.

```json
{
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "components": [
    {
      "key": "heading",
      "component": "Text",
      "properties": { "text": "Movie ranking", "variant": "h2" }
    },
    {
      "key": "table",
      "component": "DataTable",
      "properties": { "collectionId": "22222222-2222-4222-8222-222222222222" }
    },
    {
      "key": "form",
      "component": "CollectionForm",
      "properties": { "collectionId": "22222222-2222-4222-8222-222222222222" }
    },
    {
      "key": "chart",
      "component": "CollectionChart",
      "properties": {
        "collectionId": "22222222-2222-4222-8222-222222222222",
        "field": "rating"
      }
    }
  ]
}
```

The table already supports record editing, sorting, filtering and pagination. Its columns and the form's fields come from the collection schema; do not provide `columns` or `fields` arrays. Optional titles accept official dynamic strings.

## Layout and updates

Each component has a catalog type and catalog-validated `properties`. An optional `key` is a batch-local alias, not a saved ID. To create nested layouts, add a Row or Column whose `properties.children` lists local keys, or a Card whose `properties.child` names one key. Forward references work. Tabs and List references are also resolved in their official child-reference slots. Local keys take precedence over existing IDs. PAW generates collision-free IDs and mounts only unreferenced batch components, in input order.

`layout` optionally selects an existing `parentId` (default `root`), a zero-based insertion `index` (default append), and a `direction` (`Column` or `Row`) for that parent. Existing children are preserved. All nested references, cycles, bounds and collection bindings are validated before a single save; an invalid batch saves nothing.

For updates, provide `workspaceId`, `revision`, `componentId` and a partial `properties` object. Patches merge shallowly with current properties. `removeProperties` removes optional properties. `placement: {parentId,index}` moves/reorders the same component ID. Other component IDs and collection records remain unchanged. Failed or stale writes return the existing executor error envelope and never overwrite newer revisions.

## Scope and limits

- All 13 current catalog components are discoverable and accepted. Property types are checked by their original Zod 3 catalog APIs; the Zod 4 tool envelope does not duplicate component schemas. Final document validation uses the official strict processor.
- Batches contain 1–100 components. Existing document limits (200 components per surface, 200 messages, eight surfaces, depth and size limits) still apply. Operations append official messages; they do not compact history.
- Placement targets must be existing Columns/Rows with fixed children arrays. Moving a shared component or a child out of a Card/tab/template requires raw A2UI tools. Moving root, deleting required properties, cycles, dangling references and orphaning children are rejected. Component type/ID changes are outside the patch operation.
- Omit `surfaceId` only for a single-surface interface. Other surfaces and saved data-model messages are preserved. Non-layout roots remain compatible with raw tools; they are not silently rewritten.
- Describe-before-invoke, workspace scope, ownership, write permissions, revision checks and mutation journaling use the existing execution path. Resource relationships advertise the new operations alongside the raw tools.

## Files

- `apps/web/src/features/interfaces/model/authoring.ts`: strict tool envelopes with catalog-backed property validation.
- `apps/web/src/features/interfaces/protocol/{authoring,discovery}.ts`: pure A2UI message generation, reference resolution, catalog-derived discovery and examples.
- `apps/web/src/features/interfaces/server/{service,tools}.ts`: authorized atomic saves and registry capabilities with concise results.
- `apps/web/src/composition/{services,resources,tools}.ts`: bind the feature methods, advertise related operations and clarify resource-versus-component discovery.
- `tests/ui-authoring.test.ts`, `tests/integration.test.ts`, `tests/browser/ui-authoring.spec.ts`: discovery, layout, validation, ownership, revision/race, auditing and movie benchmark coverage.
- `package.json` runs the new unit test file. `tests/architecture.test.ts` explicitly permits the three additive capabilities while retaining the original 22-tool fixture and checking it with only two explicitly tested description changes.
