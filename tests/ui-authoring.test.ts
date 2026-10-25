import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addUiInput,
  updateUiInput,
} from "../apps/web/src/features/interfaces/model/authoring";
import {
  addUiComponents,
  updateUiComponent,
} from "../apps/web/src/features/interfaces/protocol/authoring";
import {
  componentAuthoringExample,
  searchUiComponents,
} from "../apps/web/src/features/interfaces/protocol/discovery";
import {
  componentApis,
  PROTOCOL,
} from "../apps/web/src/features/interfaces/protocol/catalog";
import {
  emptyInterface,
  inspectInterface,
  parseInterface,
  type Interface,
} from "../apps/web/src/features/interfaces/protocol/document";
import { InterfaceService } from "../apps/web/src/features/interfaces/server/service";
import { ServiceError } from "../apps/web/src/shared/db/result";
import { createToolRegistry } from "../apps/web/src/composition/tools";
import { ToolExecutor } from "../apps/web/src/features/tooling/server/executor";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const collectionId = "22222222-2222-4222-8222-222222222222";
const movieComponents = [
  {
    key: "heading",
    component: "Text",
    properties: { text: "Movie ranking", variant: "h2" },
  },
  { key: "table", component: "DataTable", properties: { collectionId } },
  { key: "form", component: "CollectionForm", properties: { collectionId } },
  {
    key: "chart",
    component: "CollectionChart",
    properties: { collectionId, field: "rating" },
  },
];
const add = (
  components = movieComponents,
  rest: Record<string, unknown> = {},
) => addUiInput.parse({ workspaceId, revision: 1, components, ...rest });
const update = (componentId: string, rest: Record<string, unknown> = {}) =>
  updateUiInput.parse({ workspaceId, revision: 2, componentId, ...rest });

test("component discovery derives requirements from the catalog and every example produces official A2UI", () => {
  assert.equal(searchUiComponents("editable table")[0].component, "DataTable");
  assert.ok(
    searchUiComponents("movie rating chart").some(
      (c) => c.component === "CollectionChart",
    ),
  );
  assert.deepEqual(searchUiComponents("no_matching_widget"), []);
  for (const api of componentApis) {
    const detail = componentAuthoringExample(api.name);
    assert.deepEqual(
      detail.requiredProperties,
      Object.entries(api.schema.shape)
        .filter(([, s]) => !s.isOptional())
        .map(([key]) => key),
    );
    const authored = addUiComponents(
      emptyInterface(),
      addUiInput.parse({ workspaceId, revision: 1, ...detail.example }),
    );
    assert.doesNotThrow(() => parseInterface(authored.definition));
    assert.ok(detail.schema);
  }
  assert.deepEqual(componentAuthoringExample("DataTable").requiredProperties, [
    "collectionId",
  ]);
  assert.deepEqual(
    componentAuthoringExample("CollectionForm").requiredProperties,
    ["collectionId"],
  );
  assert.throws(() => componentAuthoringExample("MadeUp"), /Unknown/);
});

test("one movie batch generates stable IDs and official messages while preserving existing model data", () => {
  const original = emptyInterface();
  original.messages.push({
    version: PROTOCOL,
    updateDataModel: {
      surfaceId: "workspace",
      path: "/title",
      value: "Keep me",
    },
  });
  const before = JSON.stringify(original);
  const input = add();
  const inputBefore = JSON.stringify(input);
  const result = addUiComponents(original, input);
  const components = inspectInterface(result.definition)[0].components;
  assert.equal(components.length, 5);
  assert.deepEqual(
    components.find((c) => c.id === "root")!.children,
    result.components.map((c) => c.id),
  );
  assert.deepEqual(
    result.components.map((c) => c.key),
    ["heading", "table", "form", "chart"],
  );
  assert.equal(JSON.stringify(original), before);
  assert.equal(JSON.stringify(input), inputBefore);
  assert.deepEqual(
    result.definition.messages.slice(0, original.messages.length),
    original.messages,
  );
  assert.ok(
    result.definition.messages.every((message) => message.version === "v0.9.1"),
  );
  const next = addUiComponents(
    result.definition,
    add([{ key: "more", component: "Text", properties: { text: "More" } }]),
  );
  assert.ok(!result.components.some((c) => c.id === next.components[0].id));
});

test("batch child keys resolve forward references in Row, Column and Card and attach only top-level components", () => {
  const result = addUiComponents(
    emptyInterface(),
    addUiInput.parse({
      workspaceId,
      revision: 1,
      components: [
        { key: "card", component: "Card", properties: { child: "row" } },
        {
          key: "row",
          component: "Row",
          properties: { children: ["table", "column"] },
        },
        {
          key: "column",
          component: "Column",
          properties: { children: ["form", "chart"] },
        },
        ...movieComponents,
      ],
      layout: { parentId: "root", direction: "Column", index: 0 },
    }),
  );
  const ids = new Map(result.components.map((c) => [c.key, c.id]));
  const components = inspectInterface(result.definition)[0].components;
  const get = (key: string) => components.find((c) => c.id === ids.get(key))!;
  assert.equal(get("card").child, ids.get("row"));
  assert.deepEqual(get("row").children, [ids.get("table"), ids.get("column")]);
  assert.deepEqual(components.find((c) => c.id === "root")!.children, [
    ids.get("card"),
    ids.get("heading"),
  ]);
});

test("invalid properties, references, duplicate aliases and cycles fail atomically", () => {
  const original = emptyInterface();
  const before = JSON.stringify(original);
  for (const component of [
    {
      component: "DataTable",
      properties: { collectionId, columns: ["title"] },
    },
    { component: "CollectionForm", properties: { collectionId, fields: [] } },
    { component: "CollectionChart", properties: { collectionId } },
    { component: "Text", properties: { text: 9 } },
    { component: "Text", properties: { text: "x", id: "root" } },
    { component: "Script", properties: {} },
  ])
    assert.equal(
      addUiInput.safeParse({
        workspaceId,
        revision: 1,
        components: [component],
      }).success,
      false,
    );
  for (const components of [
    [
      { key: "x", component: "Text", properties: { text: "a" } },
      { key: "x", component: "Text", properties: { text: "b" } },
    ],
    [{ component: "Card", properties: { child: "missing" } }],
    [{ key: "x", component: "Column", properties: { children: ["x"] } }],
    [
      { key: "x", component: "Row", properties: { children: ["y"] } },
      { key: "y", component: "Column", properties: { children: ["x"] } },
    ],
  ])
    assert.throws(() =>
      addUiComponents(
        original,
        addUiInput.parse({ workspaceId, revision: 1, components }),
      ),
    );
  assert.equal(JSON.stringify(original), before);
});

test("property patches and placement preserve unaffected components, IDs and model messages", () => {
  const original = addUiComponents(
    emptyInterface(),
    addUiInput.parse({
      workspaceId,
      revision: 1,
      components: [
        {
          key: "group",
          component: "Row",
          properties: { children: ["table", "chart"] },
        },
        ...movieComponents,
      ],
    }),
  );
  const ids = new Map(original.components.map((c) => [c.key!, c.id]));
  const before = inspectInterface(original.definition)[0].components;
  const result = updateUiComponent(
    original.definition,
    update(ids.get("chart")!, {
      properties: { title: { path: "/title" } },
      placement: { parentId: "root", index: 0 },
    }),
  );
  const after = inspectInterface(result.definition)[0].components;
  assert.deepEqual(
    after.find((c) => c.id === ids.get("form")),
    before.find((c) => c.id === ids.get("form")),
  );
  assert.deepEqual(
    after.find((c) => c.id === ids.get("table")),
    before.find((c) => c.id === ids.get("table")),
  );
  assert.equal(after.find((c) => c.id === ids.get("chart"))!.field, "rating");
  assert.deepEqual(after.find((c) => c.id === ids.get("group"))!.children, [
    ids.get("table"),
  ]);
  assert.deepEqual(after.find((c) => c.id === "root")!.children, [
    ids.get("chart"),
    ids.get("group"),
    ids.get("heading"),
    ids.get("form"),
  ]);
  const cleared = updateUiComponent(
    result.definition,
    update(ids.get("chart")!, {
      removeProperties: ["title"],
      placement: { parentId: "root", index: 3 },
    }),
  );
  assert.equal(
    inspectInterface(cleared.definition)[0].components.find(
      (c) => c.id === ids.get("chart"),
    )!.title,
    undefined,
  );
  assert.throws(() =>
    updateUiComponent(
      result.definition,
      update(ids.get("chart")!, { removeProperties: ["field"] }),
    ),
  );
  assert.throws(() =>
    updateUiComponent(
      result.definition,
      update(ids.get("chart")!, { properties: { component: "Text" } }),
    ),
  );
  assert.throws(() =>
    updateUiComponent(
      result.definition,
      update(ids.get("group")!, { placement: { parentId: ids.get("group") } }),
    ),
  );
  assert.throws(() =>
    updateUiComponent(
      result.definition,
      update("root", { placement: { parentId: "root" } }),
    ),
  );
  assert.throws(() => updateUiComponent(result.definition, update("missing")));
});

function memoryService() {
  let workspace = { id: workspaceId, revision: 1, interface: emptyInterface() };
  let writes = 0;
  let race = false;
  const collections = [
    {
      id: collectionId,
      workspace_id: workspaceId,
      name: "Movies",
      fields: [
        {
          key: "title",
          label: "Title",
          type: "string" as const,
          required: true,
        },
        {
          key: "rating",
          label: "Rating",
          type: "number" as const,
          required: true,
        },
      ],
    },
  ];
  const db = {
    from(table: string) {
      assert.equal(table, "workspaces");
      return {
        update(value: { interface: Interface }) {
          const conditions: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) {
              conditions[key] = value;
              return query;
            },
            select() {
              return query;
            },
            async maybeSingle() {
              if (race)
                workspace = { ...workspace, revision: workspace.revision + 1 };
              if (conditions.revision !== workspace.revision)
                return { data: null, error: null };
              assert.equal(conditions.user_id, workspaceId);
              workspace = {
                ...workspace,
                interface: value.interface,
                revision: workspace.revision + 1,
              };
              writes++;
              return { data: workspace, error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const access = {
    workspace: async (id: string) => {
      if (id !== workspaceId)
        throw new ServiceError("Workspace not found.", 404);
      return workspace;
    },
  };
  const service = new InterfaceService(db as any, workspaceId, access, {
    collections: async () => collections,
  });
  return {
    service,
    access,
    current: () => workspace,
    writes: () => writes,
    race: () => {
      race = true;
    },
  };
}

test("services retain ownership, bindings, strict validation and compare-and-swap protection", async () => {
  const s = memoryService();
  const saved = await s.service.addUiComponents(add());
  assert.equal(saved.revision, 2);
  assert.equal(saved.components.length, 4);
  assert.equal((saved as any).definition, undefined);
  assert.equal(JSON.stringify(saved).includes("messages"), false);
  const chart = saved.components.find((c) => c.key === "chart")!.id;
  await s.service.updateUiComponent(
    update(chart, { properties: { title: "Ratings" } }),
  );
  assert.equal(s.current().revision, 3);
  await assert.rejects(
    () => s.service.addUiComponents(add()),
    (error: any) => error.status === 409,
  );
  await assert.rejects(
    () => s.service.addUiComponents({ ...add(), workspaceId: collectionId }),
    /not found/,
  );
  await assert.rejects(
    () =>
      s.service.addUiComponents({
        ...add([
          {
            key: "bad",
            component: "DataTable",
            properties: { collectionId: workspaceId },
          },
        ]),
        revision: 3,
      }),
    /outside this workspace/,
  );
  await assert.rejects(
    () =>
      s.service.updateUiComponent({
        ...update(chart, { properties: { field: "missing" } }),
        revision: 3,
      }),
    /unknown field/,
  );
  assert.equal(s.writes(), 2);
  s.race();
  await assert.rejects(
    () =>
      s.service.updateUiComponent({
        ...update(chart, { properties: { title: "Race" } }),
        revision: 3,
      }),
    (error: any) => error.status === 409,
  );
  assert.equal(s.writes(), 2);
});

test("new capabilities use registry permissions and scoped execution; legacy inspection retains schema fields", async () => {
  const s = memoryService();
  const service = {
    ...s.access,
    addUiComponents: s.service.addUiComponents.bind(s.service),
    updateUiComponent: s.service.updateUiComponent.bind(s.service),
  } as any;
  const registry = createToolRegistry();
  const reader = new ToolExecutor(registry, {
    service,
    permissions: new Set(["read"]),
    workspaceId,
  });
  assert.equal((await reader.execute("add_ui_components", add())).ok, false);
  const writer = new ToolExecutor(registry, {
    service,
    permissions: new Set(["read", "write"]),
    workspaceId,
  });
  const scope = await writer.execute("add_ui_components", {
    ...add(),
    workspaceId: collectionId,
  });
  assert.equal(!scope.ok && scope.error.code, "forbidden");
  const discovered = await writer.execute("search_ui_components", {
    query: "movie table",
  });
  assert.ok(discovered.ok && Array.isArray(discovered.data));
  const detail = await writer.execute("inspect_component", {
    component: "DataTable",
  });
  assert.ok(
    detail.ok &&
      (detail.data as any).properties.collectionId &&
      (detail.data as any)["x-paw-authoring"].example,
  );
  const result = await writer.execute("add_ui_components", add());
  assert.equal(result.ok, true);
  assert.equal(s.writes(), 1);
});

test("authoring respects surface boundaries and preserves raw A2UI layout definitions", () => {
  const definition = emptyInterface();
  definition.messages.push(
    {
      version: PROTOCOL,
      createSurface: {
        surfaceId: "other",
        catalogId: "https://paw.local/catalogs/workspace-v1.json",
      },
    },
    {
      version: PROTOCOL,
      updateComponents: {
        surfaceId: "other",
        components: [{ id: "root", component: "Text", text: "Keep this root" }],
      },
    },
  );
  assert.throws(() => addUiComponents(definition, add()), /surfaceId/);
  assert.throws(
    () =>
      addUiComponents(definition, add(movieComponents, { surfaceId: "other" })),
    /Column or Row/,
  );
  const result = addUiComponents(
    definition,
    add(movieComponents, { surfaceId: "workspace" }),
  );
  assert.deepEqual(
    inspectInterface(result.definition).find((s) => s.surfaceId === "other"),
    inspectInterface(definition).find((s) => s.surfaceId === "other"),
  );
  assert.throws(
    () =>
      addUiComponents(
        emptyInterface(),
        add(movieComponents, { layout: { parentId: "root", index: 2 } }),
      ),
    /beyond the end/,
  );
});

test("authoring still requires describe-before-invoke and journals each mutation through ToolSession", async () => {
  const { ToolSession } =
    await import("../apps/web/src/features/agent/server/tool-session");
  const { agentLimits } =
    await import("../apps/web/src/features/agent/server/limits");
  const s = memoryService();
  const service = {
    ...s.access,
    addUiComponents: s.service.addUiComponents.bind(s.service),
    updateUiComponent: s.service.updateUiComponent.bind(s.service),
  } as any;
  const executor = new ToolExecutor(createToolRegistry(), {
    service,
    workspaceId,
    permissions: new Set(["read", "write"]),
  });
  const journal: any[] = [],
    events: any[] = [];
  const session = new ToolSession(
    executor,
    {
      event: async (...args) => {
        journal.push(args);
        return true;
      },
      finish: async () => {},
    },
    agentLimits({}),
  );
  let index = 0;
  const execute = async (name: string, args: unknown) => {
    const message = await session.execute(
      { type: "call", id: `call-${++index}`, name, args },
      { turnId: workspaceId, workspaceId, callIndex: index },
      new AbortController().signal,
      (e) => events.push(e),
    );
    return (message.content as any)[0].output.value;
  };
  const denied = await execute("invoke_tool", {
    toolId: "add_ui_components",
    arguments: add(),
  });
  assert.equal(denied.error.code, "schema_required");
  assert.equal(s.writes(), 0);
  await execute("describe_tool", { toolId: "add_ui_components" });
  const saved = await execute("invoke_tool", {
    toolId: "add_ui_components",
    arguments: add(),
  });
  assert.equal(saved.ok, true);
  const componentId = saved.data.components[0].id;
  const patch = update(componentId, { properties: { text: "Updated" } });
  assert.equal(
    (
      await execute("invoke_tool", {
        toolId: "update_ui_component",
        arguments: patch,
      })
    ).error.code,
    "schema_required",
  );
  await execute("describe_tool", { toolId: "update_ui_component" });
  assert.equal(
    (
      await execute("invoke_tool", {
        toolId: "update_ui_component",
        arguments: patch,
      })
    ).ok,
    true,
  );
  assert.equal(s.writes(), 2);
  assert.equal(events.filter((e) => e.type === "mutation").length, 2);
  assert.equal(
    journal.filter(
      (row) => row[2] === "assistant" && row[3][0].type === "tool_call",
    ).length,
    6,
  );
  assert.equal(
    journal.filter((row) => row[2] === "tool" && row[3][0].result.ok).length,
    4,
  );
});

test("official List template references resolve batch keys without rewriting data bindings", () => {
  const result = addUiComponents(
    emptyInterface(),
    addUiInput.parse({
      workspaceId,
      revision: 1,
      components: [
        {
          key: "list",
          component: "List",
          properties: { children: { componentId: "item", path: "/items" } },
        },
        {
          key: "item",
          component: "Text",
          properties: { text: { path: "/title" } },
        },
      ],
    }),
  );
  const listId = result.components.find((c) => c.key === "list")!.id;
  const itemId = result.components.find((c) => c.key === "item")!.id;
  const components = inspectInterface(result.definition)[0].components;
  assert.deepEqual(components.find((c) => c.id === listId)!.children, {
    componentId: itemId,
    path: "/items",
  });
  assert.deepEqual(components.find((c) => c.id === itemId)!.text, {
    path: "/title",
  });
  assert.deepEqual(components.find((c) => c.id === "root")!.children, [listId]);
});
