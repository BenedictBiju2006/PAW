import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { emptyInterface, inspectInterface } from "../packages/a2ui/document";
import { CATALOG_ID, PROTOCOL } from "../packages/a2ui/catalog";
import { WorkspaceService } from "../packages/core/services";
const enabled = Boolean(process.env.PAW_TEST_REST_URL);
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
function client(user?: string) {
  const url = process.env.PAW_TEST_REST_URL!;
  const payload = Buffer.from(
    JSON.stringify({
      role: user ? "authenticated" : "anon",
      sub: user,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const signature = createHmac("sha256", process.env.PAW_TEST_JWT_SECRET!)
    .update(`${header}.${payload}`)
    .digest("base64url");
  const jwt = `${header}.${payload}.${signature}`;
  // Services use the same user-scoped PostgREST client as production. Local standalone
  // PostgREST has no /rest/v1 prefix, so only that transport path is adjusted.
  return createClient(url, "local-test-key", {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
      fetch: (input, init) =>
        fetch(String(input).replace("/rest/v1", ""), init),
    },
    auth: { persistSession: false },
  });
}
test(
  "Postgres + PostgREST: persistence, scoped services, RLS, validation, and revision transactions",
  { skip: !enabled },
  async (t) => {
    const dbA = client(a),
      dbB = client(b),
      anonymous = client();
    const owner = new WorkspaceService(dbA, a),
      stranger = new WorkspaceService(dbB, b);
    let workspace: any, collection: any, record: any;
    await t.test(
      "forward migration preserves legacy interfaces, records, revisions, and supports conversion/restore",
      async () => {
        const legacyId = "33333333-3333-4333-8333-333333333333";
        const raw = (
          await dbA.from("workspaces").select("*").eq("id", legacyId).single()
        ).data;
        assert.equal(raw.interface.version, 1);
        assert.equal(raw.revision, 2);
        const migrated = await owner.workspace(legacyId);
        assert.ok(migrated.interface.messages);
        assert.ok(
          inspectInterface(migrated.interface)[0].components.some(
            (c) => c.text === "Keep this heading",
          ),
        );
        await owner.rename(legacyId, "Renamed legacy");
        const saved = await owner.saveInterface(
          legacyId,
          migrated.interface,
          2,
        );
        assert.equal(saved.revision, 3);
        assert.equal(
          (
            await owner.records(
              legacyId,
              "44444444-4444-4444-8444-444444444444",
            )
          ).total,
          1,
        );
        const history = await owner.revisions(legacyId);
        assert.equal(
          history.find((r) => r.revision === 2).definition.version,
          1,
        );
        await owner.saveInterface(legacyId, emptyInterface(), 3);
        const restored = await owner.saveInterface(
          legacyId,
          history.find((r) => r.revision === 2).definition,
          4,
        );
        assert.equal(restored.revision, 5);
        assert.ok(
          inspectInterface(restored.interface)[0].components.some(
            (c) => c.component === "CollectionForm",
          ),
        );
        await owner.remove(legacyId, true);
      },
    );
    await t.test(
      "creates an empty workspace and an initial immutable revision",
      async () => {
        workspace = await owner.create("Reading");
        assert.equal(workspace.revision, 1);
        assert.deepEqual(workspace.interface, emptyInterface());
        assert.equal((await owner.revisions(workspace.id)).length, 1);
      },
    );
    await t.test(
      "stores typed data and recovers it through a new client",
      async () => {
        collection = await owner.createCollection(workspace.id, {
          name: "Books",
          fields: [
            { key: "title", label: "Title", type: "string", required: true },
            { key: "rating", label: "Rating", type: "number" },
            { key: "read", label: "Read", type: "boolean" },
          ],
        });
        record = await owner.writeRecord(workspace.id, collection.id, {
          title: "Book",
          rating: 0,
          read: false,
        });
        const returning = new WorkspaceService(client(a), a);
        const page = await returning.records(workspace.id, collection.id);
        assert.equal(page.total, 1);
        assert.equal(page.records![0].data.read, false);
        assert.equal((await returning.workspace(workspace.id)).name, "Reading");
      },
    );
    await t.test(
      "denies cross-user reads and writes at service and database boundaries",
      async () => {
        await assert.rejects(
          () => stranger.workspace(workspace.id),
          /not found/,
        );
        await assert.rejects(() =>
          stranger.writeRecord(workspace.id, collection.id, {
            title: "Attack",
          }),
        );
        for (const table of [
          "workspaces",
          "collections",
          "records",
          "interface_revisions",
        ]) {
          const result = await dbB.from(table).select("*");
          assert.ifError(result.error);
          assert.deepEqual(result.data, []);
        }
        const write = await dbB.from("records").insert({
          workspace_id: workspace.id,
          collection_id: collection.id,
          data: { title: "Attack" },
        });
        assert.ok(write.error);
        const update = await dbB
          .from("records")
          .update({ data: { title: "Attack" } })
          .eq("id", record.id)
          .select();
        assert.ifError(update.error);
        assert.deepEqual(update.data, []);
        const impersonated = await dbB
          .from("workspaces")
          .insert({ user_id: a, name: "Attack" });
        assert.ok(impersonated.error);
        assert.ok((await anonymous.from("workspaces").select("*")).error);
      },
    );
    await t.test(
      "database rejects invalid data even when services are bypassed",
      async () => {
        for (const data of [
          { title: 4 },
          { title: "Bad", rating: "5" },
          { title: "Bad", extra: true },
        ]) {
          assert.ok(
            (
              await dbA.from("records").insert({
                workspace_id: workspace.id,
                collection_id: collection.id,
                data,
              })
            ).error,
          );
        }
        assert.ok(
          (
            await dbA.from("collections").insert({
              workspace_id: workspace.id,
              name: "Bad",
              fields: [{ key: "x", label: "X", type: "enum", required: false }],
            })
          ).error,
        );
        assert.ok(
          (
            await dbA
              .from("collections")
              .update({ fields: [] })
              .eq("id", collection.id)
          ).error,
        );
      },
    );
    await t.test(
      "interface commits are atomic and stale writers cannot overwrite",
      async () => {
        const definition = {
          version: 1,
          nodes: [{ id: "table", type: "table", collectionId: collection.id }],
        };
        workspace = await owner.saveInterface(workspace.id, definition, 1);
        assert.equal(workspace.revision, 2);
        await assert.rejects(
          () => owner.saveInterface(workspace.id, { version: 1, nodes: [] }, 1),
          /another session/,
        );
        assert.ok(
          (
            await dbA
              .from("workspaces")
              .update({
                interface: {
                  version: 1,
                  nodes: [{ id: "bad", type: "script" }],
                },
              })
              .eq("id", workspace.id)
          ).error,
        );
        assert.equal((await owner.workspace(workspace.id)).revision, 2);
        assert.equal((await owner.revisions(workspace.id)).length, 2);
        assert.ok(
          (
            await dbA.from("interface_revisions").insert({
              workspace_id: workspace.id,
              revision: 99,
              definition: {},
            })
          ).error,
        );
      },
    );
    await t.test(
      "cross-workspace collection bindings and record moves are rejected",
      async () => {
        const other = await owner.create("Other");
        await assert.rejects(
          () =>
            owner.saveInterface(
              other.id,
              {
                version: 1,
                nodes: [
                  { id: "x", type: "table", collectionId: collection.id },
                ],
              },
              1,
            ),
          /outside this workspace/,
        );
        assert.ok(
          (
            await dbA.from("records").insert({
              workspace_id: other.id,
              collection_id: collection.id,
              data: { title: "Cross scope" },
            })
          ).error,
        );
        assert.ok(
          (
            await dbA
              .from("records")
              .update({ workspace_id: other.id })
              .eq("id", record.id)
          ).error,
        );
        await owner.remove(other.id, true);
      },
    );
    await t.test(
      "removing an interface preserves data and rollback creates a new revision",
      async () => {
        const revisions = await owner.revisions(workspace.id);
        const blank = await owner.saveInterface(
          workspace.id,
          { version: 1, nodes: [] },
          2,
        );
        assert.equal(blank.revision, 3);
        assert.equal(
          (await owner.records(workspace.id, collection.id)).total,
          1,
        );
        const restored = await owner.saveInterface(
          workspace.id,
          revisions[0].definition,
          3,
        );
        assert.equal(restored.revision, 4);
        assert.ok(
          inspectInterface(restored.interface)[0].components.some(
            (c) => c.id === "table",
          ),
        );
      },
    );
    await t.test(
      "native A2UI updates, catalog inspection, and direct invalid writes stay scoped and atomic",
      async () => {
        const shared = await owner.create("Shared child layout");
        const sharedDefinition = {
          messages: [
            emptyInterface().messages[0],
            {
              version: PROTOCOL,
              updateComponents: {
                surfaceId: "workspace",
                components: [
                  { id: "root", component: "Row", children: ["left", "right"] },
                  { id: "left", component: "Column", children: ["text"] },
                  { id: "right", component: "Column", children: ["text"] },
                  { id: "text", component: "Text", text: "Shared content" },
                ],
              },
            },
          ],
        };
        assert.equal(
          (await owner.saveInterface(shared.id, sharedDefinition, 1)).revision,
          2,
        );
        await owner.remove(shared.id, true);
        const native = await owner.applyInterfaceMessages(
          workspace.id,
          [
            {
              version: PROTOCOL,
              updateDataModel: {
                surfaceId: "workspace",
                path: "/title",
                value: "Incremental title",
              },
            },
          ],
          4,
        );
        assert.equal(native.revision, 5);
        assert.ok(
          (await owner.inspect(workspace.id))[0].components.some(
            (c) => c.component === "DataTable",
          ),
        );
        assert.equal((owner.catalog() as any).catalogId, CATALOG_ID);
        await assert.rejects(() =>
          stranger.applyInterfaceMessages(workspace.id, [], 5),
        );
        for (const components of [
          [{ id: "root", component: "Script" }],
          [{ id: "root", component: "Column", children: ["missing"] }],
          [{ id: "root", component: "Text", text: 123 }],
          [{ id: "root", component: "Column", children: ["root"] }],
          [{ id: "root", component: "Text", text: "OK", onClick: "evil" }],
        ]) {
          const definition = {
            messages: [
              emptyInterface().messages[0],
              {
                version: PROTOCOL,
                updateComponents: { surfaceId: "workspace", components },
              },
            ],
          };
          assert.ok(
            (
              await dbA
                .from("workspaces")
                .update({ interface: definition })
                .eq("id", workspace.id)
            ).error,
          );
          await assert.rejects(() =>
            owner.saveInterface(workspace.id, definition, 5),
          );
        }
        assert.equal((await owner.workspace(workspace.id)).revision, 5);
        assert.equal(
          (await owner.records(workspace.id, collection.id)).total,
          1,
        );
      },
    );
    await t.test(
      "editing, exact filtering, numeric sorting, and bounded pagination work",
      async () => {
        await owner.writeRecord(
          workspace.id,
          collection.id,
          { title: "Changed", rating: 10, read: true },
          record.id,
          record.updated_at,
        );
        await assert.rejects(
          () =>
            owner.writeRecord(
              workspace.id,
              collection.id,
              { title: "Stale edit" },
              record.id,
              record.updated_at,
            ),
          /Record changed/,
        );
        await owner.writeRecord(workspace.id, collection.id, {
          title: "Second",
          rating: 2,
          read: false,
        });
        const filtered = await owner.records(workspace.id, collection.id, {
          filter: "read",
          value: "false",
        });
        assert.equal(filtered.total, 1);
        assert.equal(filtered.records![0].data.title, "Second");
        const sorted = await owner.records(workspace.id, collection.id, {
          sort: "rating",
          direction: "asc",
          limit: 1,
        });
        assert.equal(sorted.total, 2);
        assert.equal(sorted.records![0].data.rating, 2);
        const next = await owner.records(workspace.id, collection.id, {
          sort: "rating",
          direction: "asc",
          limit: 1,
          offset: 1,
        });
        assert.equal(next.records![0].data.rating, 10);
        const aggregate = await owner.aggregate(
          workspace.id,
          collection.id,
          "rating",
        );
        assert.equal(aggregate.count, 2);
        assert.equal(aggregate.average, 6);
        assert.equal(aggregate.sum, 12);
        await assert.rejects(() =>
          stranger.aggregate(workspace.id, collection.id, "rating"),
        );
        assert.ok(
          (
            await dbB.rpc("aggregate_records", {
              target_workspace: workspace.id,
              target_collection: collection.id,
              field_key: "rating",
            })
          ).error,
        );
        await assert.rejects(() =>
          owner.records(workspace.id, collection.id, { limit: 101 }),
        );
      },
    );
    await t.test(
      "deletions need confirmation and workspace cleanup cascades safely",
      async () => {
        await assert.rejects(() =>
          owner.deleteRecord(workspace.id, collection.id, record.id, false),
        );
        await owner.deleteRecord(workspace.id, collection.id, record.id, true);
        await assert.rejects(() => owner.remove(workspace.id, false));
        await owner.rename(workspace.id, "Renamed");
        assert.equal((await owner.workspace(workspace.id)).name, "Renamed");
        await owner.remove(workspace.id, true);
        assert.equal((await owner.list()).length, 0);
        assert.equal((await dbA.from("records").select("*")).data?.length, 0);
        assert.equal(
          (await dbA.from("interface_revisions").select("*")).data?.length,
          0,
        );
      },
    );
  },
);

test(
  "Milestone 2: deterministic tool discovery, MCP interoperability, conversations and RLS",
  { skip: !enabled },
  async (t) => {
    const { createToolRegistry } =
      await import("../packages/tools/definitions");
    const { ToolExecutor } = await import("../packages/tools/executor");
    const { ConversationService } =
      await import("../packages/conversations/services");
    const { createMcpAdapter } = await import("../packages/tools/mcp");
    const { Client } =
      await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } =
      await import("@modelcontextprotocol/sdk/inMemory.js");
    const dbA = client(a),
      dbB = client(b),
      registry = createToolRegistry();
    const service = new WorkspaceService(dbA, a),
      other = new WorkspaceService(dbB, b);
    const context = {
      service,
      permissions: new Set(["read", "write", "delete"] as const),
    };
    const executor = new ToolExecutor(registry, context),
      stranger = new ToolExecutor(registry, {
        service: other,
        permissions: context.permissions,
      });
    async function call(id: string, args: unknown) {
      const result = await executor.execute(id, args);
      assert.equal(result.ok, true, JSON.stringify(result));
      return (result as { ok: true; data: any }).data;
    }
    const matches = await call("search_tools", { query: "create workspace" });
    assert.ok(matches.some((x: any) => x.id === "create_workspace"));
    assert.equal(matches[0].inputSchema, undefined);
    const descriptor = await call("describe_tool", {
      toolId: "create_workspace",
    });
    assert.equal(descriptor.inputSchema.properties.name.type, "string");
    const w = await call("create_workspace", { name: "Discovered workspace" });
    const workspaceId = w.id;
    const scoped = new ToolExecutor(registry, { ...context, workspaceId });
    await t.test(
      "discover, construct and persist a collection-backed A2UI workspace entirely through tools",
      async () => {
        assert.ok(
          (
            await call("search_tools", { query: "create collection fields" })
          ).some((x: any) => x.id === "create_collection"),
        );
        const collection = await call("create_collection", {
          workspaceId,
          name: "Books",
          fields: [
            { key: "title", label: "Title", type: "string", required: true },
          ],
        });
        const collectionId = collection.id;
        assert.ok(
          (await call("search_tools", { query: "inspect interface" })).some(
            (x: any) => x.id === "inspect_interface",
          ),
        );
        const catalog = await call("get_catalog", {});
        assert.ok(catalog.components.CollectionForm);
        assert.ok(catalog.components.DataTable);
        const current = await call("inspect_interface", { workspaceId });
        const saved = await call("apply_interface_messages", {
          workspaceId,
          revision: current.revision,
          messages: [
            {
              version: PROTOCOL,
              updateComponents: {
                surfaceId: "workspace",
                components: [
                  {
                    id: "root",
                    component: "Column",
                    children: ["form", "table"],
                  },
                  { id: "form", component: "CollectionForm", collectionId },
                  { id: "table", component: "DataTable", collectionId },
                ],
              },
            },
          ],
        });
        assert.equal(saved.revision, 2);
        const record = await call("create_record", {
          workspaceId,
          collectionId,
          data: { title: "Persistent book" },
        });
        const query = await call("query_records", {
          workspaceId,
          collectionId,
        });
        assert.equal(query.total, 1);
        assert.equal(query.records[0].id, record.id);
        const resources = await call("list_resources", {
          kind: "collections",
          workspaceId,
          limit: 1,
        });
        assert.equal(resources.items[0].name, "Books");
        const inspected = await call("inspect_resource", {
          uri: resources.items[0].uri,
        });
        assert.equal(inspected.fields[0].type, "string");
        const recordResource = await call("inspect_resource", {
          uri: `paw://workspaces/${workspaceId}/collections/${collectionId}/records/${record.id}`,
        });
        assert.equal(recordResource.record.data.title, "Persistent book");
        assert.equal(
          (await call("inspect_interface", { workspaceId })).surfaces[0]
            .components.length,
          3,
        );
        const fresh = new ToolExecutor(registry, {
          service: new WorkspaceService(client(a), a),
          permissions: context.permissions,
        });
        assert.equal(
          (await fresh.execute("query_records", { workspaceId, collectionId }))
            .ok,
          true,
        );
        for (const [tool, args] of [
          ["inspect_workspace", { workspaceId }],
          ["query_records", { workspaceId, collectionId }],
          ["inspect_resource", { uri: resources.items[0].uri }],
          [
            "create_record",
            { workspaceId, collectionId, data: { title: "Intrusion" } },
          ],
          [
            "save_interface",
            { workspaceId, definition: emptyInterface(), revision: 2 },
          ],
        ] as const)
          assert.equal((await stranger.execute(tool, args)).ok, false);
        assert.equal(
          (
            await executor.execute("save_interface", {
              workspaceId,
              definition: emptyInterface(),
              revision: 1,
            })
          ).ok,
          false,
        );
        assert.equal(
          (
            await executor.execute("apply_interface_messages", {
              workspaceId,
              revision: 2,
              messages: [
                {
                  version: PROTOCOL,
                  updateComponents: {
                    surfaceId: "workspace",
                    components: [{ id: "bad", component: "Script" }],
                  },
                },
              ],
            })
          ).ok,
          false,
        );
        assert.equal(
          (
            await executor.execute("create_record", {
              workspaceId,
              collectionId,
              data: { wrong: "field" },
            })
          ).ok,
          false,
        );
        assert.equal(
          (
            await executor.execute("update_record", {
              workspaceId,
              collectionId,
              recordId: record.id,
              data: { title: "Updated" },
              updatedAt: "2000-01-01T00:00:00Z",
            })
          ).ok,
          false,
        );
        const updated = await call("update_record", {
          workspaceId,
          collectionId,
          recordId: record.id,
          data: { title: "Updated" },
          updatedAt: record.updated_at,
        });
        assert.equal(updated.data.title, "Updated");
        assert.ok(
          await call("aggregate_records", {
            workspaceId,
            collectionId,
            field: "title",
          }),
        );
        const foreign = await stranger.execute("create_workspace", {
          name: "Other scope",
        });
        assert.equal(foreign.ok, true);
        const foreignId = (foreign as any).data.id;
        assert.equal(
          (
            await scoped.execute("inspect_workspace", {
              workspaceId: foreignId,
            })
          ).ok,
          false,
        );
        assert.equal(
          (
            await scoped.execute("inspect_resource", {
              uri: `paw://workspaces/${foreignId}`,
            })
          ).ok,
          false,
        );
        assert.equal(
          (
            await scoped.execute("list_resources", {
              kind: "records",
              workspaceId: foreignId,
              collectionId,
            })
          ).ok,
          false,
        );
        assert.equal(
          (await scoped.execute("create_workspace", { name: "Escaped" })).ok,
          false,
        );
        const pending = await executor.execute("delete_record", {
          workspaceId,
          collectionId,
          recordId: record.id,
        });
        assert.equal(pending.ok, false);
        if (!pending.ok)
          assert.equal(pending.error.code, "confirmation_required");
        let approval: any;
        const trusted = new ToolExecutor(registry, {
          ...context,
          authorizeDestructive: async (id, args) => {
            approval = { id, args };
            return true;
          },
        });
        assert.equal(
          (
            await trusted.execute("delete_record", {
              workspaceId,
              collectionId,
              recordId: record.id,
            })
          ).ok,
          true,
        );
        assert.equal(approval.args.recordId, record.id);
        assert.equal(
          (await call("query_records", { workspaceId, collectionId })).total,
          0,
        );
      },
    );
    await t.test(
      "official MCP client discovers, describes, invokes and reads scoped resources",
      async () => {
        const server = createMcpAdapter(registry, { ...context, workspaceId }),
          mcp = new Client({ name: "deterministic-client", version: "1" });
        const [transportA, transportB] = InMemoryTransport.createLinkedPair();
        await server.connect(transportA);
        await mcp.connect(transportB);
        try {
          assert.equal((await mcp.listTools()).tools.length, 4);
          const found = await mcp.callTool({
            name: "search_tools",
            arguments: { query: "query records" },
          });
          assert.deepEqual(
            JSON.parse((found.content as any)[0].text),
            await scoped.execute("search_tools", { query: "query records" }),
          );
          const described = await mcp.callTool({
            name: "describe_tool",
            arguments: { toolId: "query_records" },
          });
          assert.equal(
            JSON.parse((described.content as any)[0].text).data.id,
            "query_records",
          );
          const invoked = await mcp.callTool({
            name: "inspect_interface",
            arguments: { workspaceId },
          });
          assert.equal(JSON.parse((invoked.content as any)[0].text).ok, true);
          assert.equal((await mcp.listResources()).resources[0].name, "Books");
          const resource = await mcp.readResource({
            uri: `paw://workspaces/${workspaceId}/interface`,
          });
          assert.equal(
            JSON.parse((resource.contents[0] as any).text).revision,
            2,
          );
        } finally {
          await mcp.close();
          await server.close();
        }
      },
    );
    await t.test(
      "conversation persistence, stable pagination, cross-workspace guards and direct RLS",
      async () => {
        const conversations = new ConversationService(dbA, service),
          otherConversations = new ConversationService(dbB, other);
        const one = await conversations.create(workspaceId, "Planning"),
          two = await conversations.create(workspaceId, "Review");
        const first = await conversations.append(workspaceId, one.id, {
          role: "user",
          content: [{ type: "text", text: "Build a reading list" }],
        });
        await conversations.append(workspaceId, one.id, {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolId: "query_records",
              invocationId: "test-only",
              arguments: {},
              status: "completed",
            },
          ],
          metadata: { provider: "test", model: "fixture" },
        });
        const page = await conversations.messages(workspaceId, one.id, {
          limit: 1,
        });
        assert.equal(page.messages[0].id, first.id);
        assert.equal(page.nextOffset, 1);
        assert.equal(
          (
            await conversations.messages(workspaceId, one.id, {
              offset: 1,
              limit: 1,
            })
          ).messages[0].role,
          "assistant",
        );
        assert.equal(
          (await conversations.messages(workspaceId, two.id)).messages.length,
          0,
        );
        assert.equal(
          (
            await new ConversationService(
              client(a),
              new WorkspaceService(client(a), a),
            ).messages(workspaceId, one.id)
          ).messages.length,
          2,
        );
        assert.equal(
          (await conversations.list(workspaceId, { limit: 1 })).nextOffset,
          1,
        );
        assert.equal(
          (await conversations.rename(workspaceId, one.id, "New plan")).title,
          "New plan",
        );
        await assert.rejects(() =>
          otherConversations.messages(workspaceId, one.id),
        );
        await assert.rejects(() =>
          otherConversations.append(workspaceId, one.id, {
            role: "user",
            content: [{ type: "text", text: "Intrusion" }],
          }),
        );
        const another = await call("create_workspace", {
          name: "Separate workspace",
        });
        await assert.rejects(() => conversations.messages(another.id, one.id));
        assert.deepEqual(
          (await dbB.from("conversations").select("*").eq("id", one.id)).data,
          [],
        );
        assert.deepEqual(
          (await dbB.from("messages").select("*").eq("conversation_id", one.id))
            .data,
          [],
        );
        assert.ok(
          (
            await dbB.from("messages").insert({
              workspace_id: workspaceId,
              conversation_id: one.id,
              role: "user",
              content: [{ type: "text", text: "No" }],
            })
          ).error,
        );
        assert.ok(
          (
            await dbA.from("messages").insert({
              workspace_id: another.id,
              conversation_id: one.id,
              role: "user",
              content: [{ type: "text", text: "Mismatch" }],
            })
          ).error,
        );
        assert.ok(
          (
            await dbA
              .from("conversations")
              .update({ workspace_id: another.id })
              .eq("id", one.id)
          ).error,
        );
        assert.ok(
          (
            await dbA
              .from("messages")
              .update({ content: [] })
              .eq("id", first.id)
          ).error,
        );
        await assert.rejects(() =>
          conversations.remove(workspaceId, one.id, false),
        );
        assert.ok(
          (
            await dbA
              .from("messages")
              .insert({
                workspace_id: workspaceId,
                conversation_id: one.id,
                role: "user",
                content: [null],
              })
          ).error,
        );
        assert.ok((await client().from("messages").select("*")).error);
        await conversations.remove(workspaceId, one.id, true);
        assert.deepEqual(
          (await dbA.from("messages").select("*").eq("conversation_id", one.id))
            .data,
          [],
        );
        assert.equal(
          (await conversations.list(workspaceId)).conversations[0].id,
          two.id,
        );
      },
    );
  },
);
