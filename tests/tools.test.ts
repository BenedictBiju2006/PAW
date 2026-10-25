import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../apps/web/src/composition/tools";
import { ToolExecutor } from "../apps/web/src/features/tooling/server/executor";
import { createWorkspaceServices } from "../apps/web/src/composition/services";
import { createClient } from "@supabase/supabase-js";
import { createMcpAdapter } from "../apps/web/src/composition/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const service = createWorkspaceServices(
  createClient("http://127.0.0.1:1", "unit-test-only"),
  "11111111-1111-4111-8111-111111111111",
);
test("discovery metadata and official MCP adapter use the same executor", async () => {
  const registry = createToolRegistry();
  const context = { service, permissions: new Set(["read"] as const) };
  const executor = new ToolExecutor(registry, context);
  const server = createMcpAdapter(registry, context);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((t) => t.name),
      ["search_tools", "describe_tool", "list_resources", "inspect_resource"],
    );
    const args = { query: "create workspace" };
    const result = await client.callTool({
      name: "search_tools",
      arguments: args,
    });
    assert.deepEqual(
      JSON.parse((result.content as any)[0].text),
      await executor.execute("search_tools", args),
    );
    const described = await client.callTool({
      name: "describe_tool",
      arguments: { toolId: "inspect_interface" },
    });
    assert.equal(
      JSON.parse((described.content as any)[0].text).data.inputSchema.properties
        .workspaceId.format,
      "uuid",
    );
    const failed = await client.callTool({
      name: "no_such_tool",
      arguments: {},
    });
    assert.equal(failed.isError, true);
    assert.equal(
      (await client.listResourceTemplates()).resourceTemplates.length,
      6,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
test("executor rejects unknown tools, invalid inputs, permission violations and fake confirmations", async () => {
  const registry = createToolRegistry();
  const executor = new ToolExecutor(registry, {
    service,
    permissions: new Set(["read", "write", "delete"]),
  });
  for (const [id, args, code] of [
    ["unknown", {}, "unknown_tool"],
    ["create_workspace", { name: "" }, "invalid_arguments"],
    [
      "create_workspace",
      { name: "Test", userId: "forged" },
      "invalid_arguments",
    ],
    ["inspect_resource", { uri: "file:///etc/passwd" }, "resource_invalid"],
    [
      "delete_record",
      {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        collectionId: "11111111-1111-4111-8111-111111111111",
        recordId: "11111111-1111-4111-8111-111111111111",
        confirmed: true,
      },
      "invalid_arguments",
    ],
    [
      "delete_record",
      {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        collectionId: "11111111-1111-4111-8111-111111111111",
        recordId: "11111111-1111-4111-8111-111111111111",
      },
      "confirmation_required",
    ],
  ] as const) {
    const result = await executor.execute(id, args);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code);
  }
  const reader = new ToolExecutor(registry, {
    service,
    permissions: new Set(["read"]),
  });
  const denied = await reader.execute("create_workspace", { name: "Denied" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "forbidden");
});

test("agent discovery returns collection component schemas with only supported properties", async () => {
  const executor = new ToolExecutor(createToolRegistry(), {
    service,
    permissions: new Set(["read"]),
  });
  for (const component of ["DataTable", "CollectionForm", "CollectionChart"]) {
    const result = await executor.execute("inspect_component", { component });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error(result.error.message);
    const schema = result.data as any;
    assert.equal(schema.properties.collectionId.format, "uuid");
    assert.match(schema.properties.title.$ref, /DynamicString$/);
    assert.equal(schema.properties.columns, undefined);
    assert.equal(schema.properties.fields, undefined);
    assert.equal(schema.unevaluatedProperties, false);
  }
});
