import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MessageProcessor,
  STRICT_VALIDATION,
  getValue,
} from "@a2ui/web_core/v0_9";
import {
  emptyInterface,
  parseInterface,
  appendComponents,
  inspectInterface,
  validateBindings,
} from "../apps/web/src/features/interfaces/protocol/document";
import {
  DataTableApi,
  CatalogSchemaError,
  schemaCatalog,
  CATALOG_ID,
  PROTOCOL,
  catalogDocument,
} from "../apps/web/src/features/interfaces/protocol/catalog";
import { upgradeInterface } from "../apps/web/src/features/interfaces/protocol/legacy";

test("official A2UI protocol and PAW catalog accept and reconstruct a surface", () => {
  const definition = appendComponents(emptyInterface(), [
    {
      id: "greeting",
      component: "Text",
      text: { path: "/title" },
      variant: "h2",
    },
  ]);
  definition.messages.push({
    version: PROTOCOL,
    updateDataModel: {
      surfaceId: "workspace",
      path: "/",
      value: { title: "Hello" },
    },
  });
  assert.deepEqual(
    parseInterface(JSON.parse(JSON.stringify(definition))),
    definition,
  );
  const processor = new MessageProcessor([schemaCatalog], undefined, {
    version: PROTOCOL,
    validationConfig: STRICT_VALIDATION,
  });
  processor.processMessages(definition.messages);
  assert.equal(
    processor.getSurface("workspace")?.componentsModel.get("greeting")?.type,
    "Text",
  );
  assert.equal(processor.getSurfaces().size, 1);
  processor.dispose();
});
test("invalid messages, unsupported catalogs/components, unsafe events, and invalid props fail", () => {
  for (const component of [
    { id: "bad", component: "Script", code: "alert(1)" },
    { id: "bad", component: "Text", text: 4 },
    {
      id: "bad",
      component: "TextField",
      label: "Unsafe pattern",
      validationRegexp: "(a+)+$",
    },
    { id: "bad", component: "Text", text: "OK", onClick: "evil" },
    { id: "bad", component: "CollectionForm", collectionId: { path: "/id" } },
    {
      id: "bad",
      component: "CollectionChart",
      collectionId: "not-a-uuid",
      field: "x",
    },
  ])
    assert.throws(() => appendComponents(emptyInterface(), [component]));
  const foreign = emptyInterface();
  (foreign.messages[0] as any).createSurface.catalogId =
    "https://attacker.example/catalog.json";
  assert.throws(() => parseInterface(foreign));
  assert.throws(() =>
    parseInterface({ messages: [{ version: "v0.8", createSurface: {} }] }),
  );
  assert.throws(() =>
    appendComponents(emptyInterface(), [
      {
        id: "button",
        component: "Button",
        child: "label",
        action: { event: { name: "run_sql" } },
      },
      { id: "label", component: "Text", text: "Unsafe" },
    ]),
  );
});
test("official graph validation rejects missing references, cycles, duplicate IDs and orphans", () => {
  const invalid = [
    [{ id: "root", component: "Column", children: ["missing"] }],
    [{ id: "root", component: "Column", children: ["root"] }],
    [
      { id: "root", component: "Column", children: [] },
      { id: "orphan", component: "Text", text: "Lost" },
    ],
    [
      { id: "root", component: "Column", children: [] },
      { id: "root", component: "Column", children: [] },
    ],
  ];
  for (const components of invalid)
    assert.throws(() =>
      parseInterface({
        messages: [
          emptyInterface().messages[0],
          {
            version: PROTOCOL,
            updateComponents: { surfaceId: "workspace", components },
          },
        ],
      }),
    );
});
test("incremental component and data-model updates replay in the official processor", () => {
  const definition = appendComponents(emptyInterface(), [
    { id: "text", component: "Text", text: "Before" },
  ]);
  definition.messages.push({
    version: PROTOCOL,
    updateComponents: {
      surfaceId: "workspace",
      components: [{ id: "text", component: "Text", text: { path: "/title" } }],
    },
  });
  definition.messages.push({
    version: PROTOCOL,
    updateDataModel: { surfaceId: "workspace", path: "/title", value: "After" },
  });
  const parsed = parseInterface(definition);
  assert.deepEqual(
    inspectInterface(parsed)[0].components.find((c) => c.id === "text")?.text,
    { path: "/title" },
  );
});
test("PAW collection/field bindings enforce workspace ownership", () => {
  const collectionId = "11111111-1111-4111-8111-111111111111";
  const definition = appendComponents(emptyInterface(), [
    { id: "table", component: "DataTable", collectionId },
  ]);
  assert.throws(() => validateBindings(definition, []), /outside/);
  const collections = [
    {
      id: collectionId,
      workspace_id: collectionId,
      name: "Books",
      fields: [
        {
          key: "title",
          label: "Title",
          type: "string" as const,
          required: true,
        },
      ],
    },
  ];
  assert.doesNotThrow(() => validateBindings(definition, collections));
  const badChart = appendComponents(emptyInterface(), [
    {
      id: "chart",
      component: "CollectionChart",
      collectionId,
      field: "missing",
    },
  ]);
  assert.throws(() => validateBindings(badChart, collections), /unknown field/);
});
test("legacy conversion is deterministic, keeps root content and all original definitions untouched", () => {
  const source = {
    version: 1,
    nodes: [
      { id: "root", type: "heading", text: "Original" },
      {
        id: "group",
        type: "tabs",
        children: [{ id: "body", type: "text", text: "Keep me" }],
      },
      { id: "refresh-button", type: "button", text: "Refresh" },
    ],
  };
  const before = JSON.stringify(source);
  const first = upgradeInterface(source);
  assert.deepEqual(first, upgradeInterface(source));
  assert.equal(JSON.stringify(source), before);
  const components = inspectInterface(first)[0].components;
  assert.ok(components.some((c) => c.text === "Original"));
  assert.ok(components.some((c) => c.text === "Keep me"));
  assert.throws(() =>
    upgradeInterface({ version: 1, nodes: [{ id: "bad", type: "unknown" }] }),
  );
});
test("catalog is machine readable and exposes persistent components without model dependencies", () => {
  const catalog = catalogDocument() as any;
  assert.equal(catalog.catalogId, CATALOG_ID);
  for (const name of [
    "Text",
    "Column",
    "Row",
    "Button",
    "TextField",
    "Tabs",
    "List",
    "DataTable",
    "CollectionForm",
    "CollectionChart",
  ])
    assert.ok(catalog.components[name]);
});

for (const component of ["DataTable", "CollectionForm", "CollectionChart"]) {
  test(`${component} validates without an optional title`, () => {
    const definition = appendComponents(emptyInterface(), [
      {
        id: "collection_view",
        component,
        collectionId: "11111111-1111-4111-8111-111111111111",
        ...(component === "CollectionChart" ? { field: "title" } : {}),
      },
    ]);
    assert.equal(inspectInterface(definition)[0].components.length, 2);
  });
}

test("collection schemas expose accurate discovery properties and reject invented fields", () => {
  const catalog = catalogDocument() as any;
  for (const [name, keys] of [
    ["DataTable", ["collectionId", "title", "presentation"]],
    ["CollectionForm", ["collectionId", "title"]],
    ["CollectionChart", ["collectionId", "field", "title"]],
  ] as const) {
    const schema = catalog.components[name];
    assert.ok(schema.properties.collectionId);
    assert.match(schema.properties.title.$ref, /DynamicString$/);
    for (const key of keys) assert.ok(schema.properties[key]);
    assert.equal(schema.properties.columns, undefined);
    assert.equal(schema.properties.fields, undefined);
    for (const title of ["Movies", { path: "/title" }])
      assert.doesNotThrow(() =>
        appendComponents(emptyInterface(), [
          {
            id: "view",
            component: name,
            collectionId: "11111111-1111-4111-8111-111111111111",
            title,
            ...(name === "CollectionChart" ? { field: "title" } : {}),
          },
        ]),
      );
    for (const props of [{ columns: [] }, { fields: [] }, { title: 42 }])
      assert.throws(
        () =>
          appendComponents(emptyInterface(), [
            {
              id: "view",
              component: name,
              collectionId: "11111111-1111-4111-8111-111111111111",
              ...(name === "CollectionChart" ? { field: "title" } : {}),
              ...props,
            },
          ]),
        /Validation failed for component/,
      );
  }
});

test("schema construction errors are distinguished from invalid component properties", async () => {
  const original = DataTableApi.schema.safeParse;
  try {
    DataTableApi.schema.safeParse = () => {
      throw new Error('Invalid element at key "title": expected a Zod schema');
    };
    assert.throws(() => parseInterface(emptyInterface()), CatalogSchemaError);
    assert.throws(
      () => catalogDocument(),
      /internal schema error, not invalid interface properties/,
    );
  } finally {
    DataTableApi.schema.safeParse = original;
  }
});

test("service saves, inspects and updates a heading, table and form without changing collection data", async () => {
  const { InterfaceService } =
    await import("../apps/web/src/features/interfaces/server/service");
  const id = "11111111-1111-4111-8111-111111111111";
  const collections = [
    {
      id,
      workspace_id: id,
      name: "Movies",
      fields: [
        {
          key: "title",
          label: "Title",
          type: "string" as const,
          required: true,
        },
      ],
    },
  ];
  const before = JSON.stringify(collections);
  let workspace = { id, revision: 1, interface: emptyInterface() };
  const db = {
    from(table: string) {
      assert.equal(table, "workspaces");
      return {
        update(value: { interface: ReturnType<typeof emptyInterface> }) {
          const query = {
            eq() {
              return query;
            },
            select() {
              return query;
            },
            async maybeSingle() {
              workspace = {
                ...workspace,
                interface: value.interface,
                revision: workspace.revision + 1,
              };
              return { data: workspace, error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const service = new InterfaceService(
    db as any,
    id,
    { workspace: async () => workspace },
    { collections: async () => collections },
  );
  const definition = appendComponents(emptyInterface(), [
    { id: "heading", component: "Text", text: "Movies", variant: "h2" },
    { id: "table", component: "DataTable", collectionId: id },
    { id: "form", component: "CollectionForm", collectionId: id },
  ]);
  await service.saveInterface(id, definition, 1);
  assert.equal((await service.inspect(id))[0].components.length, 4);
  await service.applyInterfaceMessages(
    id,
    [
      {
        version: PROTOCOL,
        updateComponents: {
          surfaceId: "workspace",
          components: [
            {
              id: "heading",
              component: "Text",
              text: "My movies",
              variant: "h2",
            },
            {
              id: "table",
              component: "DataTable",
              collectionId: id,
              title: { path: "/title" },
              presentation: "list",
            },
          ],
        },
      },
    ],
    2,
  );
  const components = (await service.inspect(id))[0].components;
  assert.equal(components.find((c) => c.id === "heading")?.text, "My movies");
  assert.equal(components.find((c) => c.id === "table")?.presentation, "list");
  assert.equal(components.find((c) => c.id === "form")?.collectionId, id);
  assert.equal(JSON.stringify(collections), before);
  assert.equal(workspace.revision, 3);
});
