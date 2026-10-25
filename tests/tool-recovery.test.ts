import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createToolRegistry } from "../apps/web/src/composition/tools";
import { createWorkspaceServices } from "../apps/web/src/composition/services";
import { ToolExecutor } from "../apps/web/src/features/tooling/server/executor";
import { ToolSession } from "../apps/web/src/features/agent/server/tool-session";
import { agentLimits } from "../apps/web/src/features/agent/server/limits";
import { ServiceError } from "../apps/web/src/shared/db/result";
import {
  emptyInterface,
  inspectInterface,
} from "../apps/web/src/features/interfaces/protocol/document";
import { compactSchema } from "../apps/web/src/features/tooling/server/recovery";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const collectionId = "22222222-2222-4222-8222-222222222222";
const privateId = "33333333-3333-4333-8333-333333333333";
const base = `paw://workspaces/${workspaceId}`;
function fixture(options: { readOnly?: boolean; resultChars?: number } = {}) {
  const service = createWorkspaceServices(
    createClient("http://127.0.0.1:1", "unit-only"),
    workspaceId,
  );
  const permissions = new Set<"read" | "write" | "delete">(
    options.readOnly ? ["read"] : ["read", "write", "delete"],
  );
  let inspections = 0,
    writes = 0;
  service.workspace = async (id) => {
    if (id !== workspaceId) throw new ServiceError("Workspace not found.", 404);
    return {
      id,
      name: "Owned workspace",
      revision: 1,
      interface: emptyInterface(),
    };
  };
  const collection = {
    id: collectionId,
    workspace_id: workspaceId,
    name: "Movies",
    fields: [
      { key: "title", label: "Title", type: "string" as const, required: true },
    ],
  };
  service.collections = async () => [collection];
  service.collection = async (_workspace, id) => {
    if (id !== collectionId)
      throw new ServiceError("Collection not found.", 404);
    return collection;
  };
  service.inspect = async () => {
    inspections++;
    return inspectInterface(emptyInterface());
  };
  service.createCollection = async () => {
    writes++;
    return collection;
  };
  service.records = async () => ({ total: 0, records: [] });
  const registry = createToolRegistry();
  const executor = new ToolExecutor(registry, {
    service,
    workspaceId,
    permissions,
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
    {
      ...agentLimits({}),
      ...(options.resultChars ? { resultChars: options.resultChars } : {}),
    },
  );
  let index = 0;
  const call = async (name: string, args: unknown) => {
    const result = await session.execute(
      { type: "call", id: `call-${++index}`, name, args },
      { turnId: workspaceId, workspaceId, callIndex: index },
      new AbortController().signal,
      (e) => events.push(e),
    );
    return (result.content as any)[0].output.value;
  };
  const invoke = (toolId: string, args: unknown) =>
    call("invoke_tool", { toolId, arguments: args });
  return {
    executor,
    registry,
    permissions,
    service,
    call,
    invoke,
    journal,
    events,
    writes: () => writes,
    inspections: () => inspections,
  };
}

test("schema recovery supplies exact next action and bounded types/constraints without executing or describing", async () => {
  const s = fixture();
  const args = {
    workspaceId,
    name: "Movies",
    fields: [{ key: "title", label: "Title", type: "string", required: true }],
  };
  for (let index = 0; index < 4; index++) {
    const result = await s.invoke("create_collection", args);
    assert.equal(result.error.code, "schema_required");
    assert.deepEqual(result.error.nextAction, {
      tool: "describe_tool",
      arguments: { toolId: "create_collection" },
    });
    const schema = result.error.inputSchema;
    assert.deepEqual(schema.required, ["workspaceId", "name", "fields"]);
    assert.equal(schema.properties.workspaceId.format, "uuid");
    assert.equal(schema.properties.name.maxLength, 100);
    assert.equal(schema.properties.fields.type, "array");
    assert.equal(schema.properties.fields.maxItems, 30);
    assert.ok(JSON.stringify(schema).length <= 4000);
    assert.equal(schema.$defs, undefined);
  }
  assert.equal(s.writes(), 0);
  assert.equal(
    (await s.call("describe_tool", { toolId: "create_collection" })).ok,
    true,
  );
  assert.equal((await s.invoke("create_collection", args)).ok, true);
  assert.equal(s.writes(), 1);
  assert.equal((await s.invoke("create_collection", args)).ok, true);
  assert.equal(s.writes(), 1); // successful writes still deduplicate
  assert.equal(s.journal.filter((row) => row[2] === "tool").length, 7);
});

test("unauthorized capabilities have no preview and failed discovery never grants described state", async () => {
  const s = fixture({ readOnly: true });
  const result = await s.invoke("create_collection", {});
  assert.equal(result.error.code, "forbidden");
  assert.equal(result.error.inputSchema, undefined);
  assert.equal(
    (await s.call("describe_tool", { toolId: "create_collection" })).error.code,
    "forbidden",
  );
  const found = await s.call("search_tools", {
    query: "create collection",
    limit: 30,
  });
  assert.ok(!found.data.some((tool: any) => tool.id === "create_collection"));
  s.permissions.add("write");
  assert.equal(
    (await s.invoke("create_collection", {})).error.code,
    "schema_required",
  );
  const denied = await s.executor.schemaRecovery("create_collection", {
    workspaceId: privateId,
  });
  assert.ok(!denied.ok && denied.error.code === "forbidden");
  assert.ok(!JSON.stringify(denied).includes(privateId));
  const createWorkspace = await s.executor.schemaRecovery(
    "create_workspace",
    {},
  );
  assert.ok(!createWorkspace.ok && !createWorkspace.error.inputSchema);
});

test("oversized descriptions are not treated as successful discovery; direct domain calls also require discovery", async () => {
  const s = fixture({ resultChars: 900 });
  s.registry.register(
    {
      id: "large_schema",
      name: "large_schema",
      description: "verbose".repeat(500),
      purpose: "fixture",
      keywords: [],
      requiredPermissions: ["read"],
      sideEffects: "none",
      result: "fixture",
    },
    z.object({ value: z.string() }).strict(),
    async () => "executed",
  );
  assert.equal(
    (await s.call("describe_tool", { toolId: "large_schema" })).error.code,
    "result_too_large",
  );
  assert.equal(
    (await s.invoke("large_schema", { value: "x" })).error.code,
    "schema_required",
  );
  assert.equal(
    (await fixture().call("create_collection", {})).error.code,
    "schema_required",
  );
});

test("compact summaries retain constraints but bound recursive/verbose schemas", () => {
  const source = z.toJSONSchema(
    z
      .object({
        count: z.number().int().min(1).max(100),
        id: z.uuid(),
        mode: z.enum(["table", "list"]),
        items: z
          .array(z.object({ label: z.string().min(1).max(40) }))
          .min(1)
          .max(10),
        payload: z.json(),
        optional: z.string().default("default"),
      })
      .strict(),
    { io: "input" },
  );
  const summary = compactSchema(source) as any;
  assert.equal(summary.properties.count.minimum, 1);
  assert.equal(summary.properties.count.maximum, 100);
  assert.deepEqual(summary.properties.mode.enum, ["table", "list"]);
  assert.equal(summary.properties.items.maxItems, 10);
  assert.ok(!summary.required.includes("optional"));
  assert.ok(JSON.stringify(summary).length <= 4000);
});

for (const [tail, pattern, kind] of [
  ["collection/x", "/collections/{collectionId}", "collections"],
  ["interfaces", "/interface", "interfaces"],
  ["schemas/x", "/collections/{collectionId}/schema", "schemas"],
  [
    "records/x",
    "/collections/{collectionId}/records/{recordId}",
    "collections",
  ],
  ["components/root", "/components/{surfaceId}/{componentId}", "components"],
] as const)
  test(`malformed ${tail} returns concrete authorized guidance`, async () => {
    const s = fixture();
    const result = await s.call("inspect_resource", { uri: `${base}/${tail}` });
    assert.equal(result.error.code, "resource_invalid");
    assert.ok(
      result.error.uriPatterns.some((uri: string) => uri === base + pattern),
    );
    assert.equal(result.error.nextAction.tool, "list_resources");
    assert.equal(result.error.nextAction.arguments.kind, kind);
    assert.equal(result.error.nextAction.arguments.workspaceId, workspaceId);
  });

test("resource guidance distinguishes missing/forbidden and never suggests unverified private IDs", async () => {
  const s = fixture();
  const forbidden = await s.call("inspect_resource", {
    uri: `paw://workspaces/${privateId}/collections/${privateId}`,
  });
  assert.equal(forbidden.error.code, "forbidden");
  assert.ok(!JSON.stringify(forbidden).includes(privateId));
  const missing = await s.call("inspect_resource", {
    uri: `${base}/collections/${privateId}`,
  });
  assert.equal(missing.error.code, "not_found");
  assert.ok(!JSON.stringify(missing).includes(privateId));
  const record = await s.call("inspect_resource", {
    uri: `${base}/collections/${collectionId}/records/bad-id`,
  });
  assert.equal(record.error.code, "resource_invalid");
  assert.equal(record.error.nextAction.arguments.collectionId, collectionId);
  const unknownCollection = await s.call("inspect_resource", {
    uri: `${base}/collections/${privateId}/records/bad-id`,
  });
  assert.ok(!JSON.stringify(unknownCollection).includes(privateId));
  const type = await fixture().call("inspect_resource", {
    uri: "paw://components/DataTable",
  });
  assert.equal(type.error.nextAction.arguments.toolId, "search_ui_components");
});

test("two related malformed inspections block varying guesses but allow a corrected URI immediately", async () => {
  const s = fixture();
  for (const tail of ["collection/a", "collection/b"])
    assert.equal(
      (await s.call("inspect_resource", { uri: `${base}/${tail}` })).error.code,
      "resource_invalid",
    );
  const blocked = await s.call("inspect_resource", {
    uri: `${base}/collection/c`,
  });
  assert.equal(blocked.error.code, "recovery_required");
  assert.equal(blocked.error.nextAction.tool, "list_resources");
  assert.equal(
    (await s.call("inspect_resource", { uri: `${base}/interface` })).ok,
    true,
  );
  assert.equal(
    (await s.call("inspect_resource", { uri: `${base}/collection/d` })).error
      .code,
    "resource_invalid",
  );
});

test("missing-resource speculation stops until successful relevant discovery, not unrelated successes", async () => {
  const s = fixture();
  for (const id of ["missing_a", "missing_b"])
    assert.equal(
      (
        await s.call("inspect_resource", {
          uri: `${base}/components/workspace/${id}`,
        })
      ).error.code,
      "not_found",
    );
  assert.equal(s.inspections(), 2);
  assert.equal(
    (
      await s.call("inspect_resource", {
        uri: `${base}/components/workspace/missing_c`,
      })
    ).error.code,
    "recovery_required",
  );
  assert.equal(s.inspections(), 2);
  await s.call("search_tools", { query: "workspace" });
  assert.equal(
    (
      await s.call("inspect_resource", {
        uri: `${base}/components/workspace/missing_d`,
      })
    ).error.code,
    "recovery_required",
  );
  await s.call("list_resources", { kind: "components", workspaceId });
  assert.equal(
    (
      await s.call("inspect_resource", {
        uri: `${base}/components/workspace/root`,
      })
    ).ok,
    true,
  );
  const fresh = fixture();
  assert.equal(
    (
      await fresh.call("inspect_resource", {
        uri: `${base}/components/workspace/missing_d`,
      })
    ).error.code,
    "not_found",
  );
});

test("invalid argument patterns stop varying failures; corrected arguments and schema recovery can proceed", async () => {
  const s = fixture();
  await s.call("describe_tool", { toolId: "create_collection" });
  for (const name of [1, 2])
    assert.equal(
      (await s.invoke("create_collection", { workspaceId, name, fields: [] }))
        .error.code,
      "invalid_arguments",
    );
  assert.equal(
    (await s.invoke("create_collection", { workspaceId, name: 3, fields: [] }))
      .error.code,
    "recovery_required",
  );
  const corrected = {
    workspaceId,
    name: "Movies",
    fields: [{ key: "title", label: "Title", type: "string", required: true }],
  };
  assert.equal((await s.invoke("create_collection", corrected)).ok, true);
  assert.equal(s.writes(), 1);
  assert.equal(
    (await s.invoke("create_collection", { workspaceId, name: 4, fields: [] }))
      .error.code,
    "invalid_arguments",
  );
});

for (const code of ["conflict", "temporary", "confirmation"] as const)
  test(`${code} retries remain executable; only confirmed writes are deduplicated`, async () => {
    const s = fixture();
    let calls = 0;
    s.registry.register(
      {
        id: "retry_write",
        name: "retry_write",
        description: "Retry fixture",
        purpose: "fixture",
        keywords: [],
        requiredPermissions: ["write"],
        sideEffects: code === "confirmation" ? "destructive" : "write",
        result: "result",
      },
      z.object({ value: z.number() }).strict(),
      async () => {
        calls++;
        if (code !== "confirmation" && calls < 5)
          throw new ServiceError("Retryable", code === "conflict" ? 409 : 503);
        return { id: workspaceId };
      },
    );
    if (code === "confirmation") {
      // A host can supply approval later; model arguments never supply it.
      let approved = false;
      const executor = new ToolExecutor(s.registry, {
        service: s.service,
        workspaceId,
        permissions: s.permissions,
        authorizeDestructive: async () => approved,
      });
      const session = new ToolSession(
        executor,
        { event: async () => true, finish: async () => {} },
        agentLimits({}),
      );
      let index = 0;
      const run = async (name: string, args: unknown) =>
        (
          await session.execute(
            { type: "call", id: `c${++index}`, name, args },
            { turnId: workspaceId, workspaceId, callIndex: index },
            new AbortController().signal,
            () => {},
          )
        ).content as any;
      await run("describe_tool", { toolId: "retry_write" });
      for (let i = 0; i < 4; i++)
        assert.equal(
          (
            await run("invoke_tool", {
              toolId: "retry_write",
              arguments: { value: 1 },
            })
          )[0].output.value.error.code,
          "confirmation_required",
        );
      approved = true;
      assert.equal(
        (
          await run("invoke_tool", {
            toolId: "retry_write",
            arguments: { value: 1 },
          })
        )[0].output.value.ok,
        true,
      );
      assert.equal(calls, 1);
    } else {
      await s.call("describe_tool", { toolId: "retry_write" });
      for (let i = 0; i < 4; i++)
        assert.equal(
          (await s.invoke("retry_write", { value: 1 })).error.code,
          code === "conflict" ? "conflict" : "operation_failed",
        );
      assert.equal((await s.invoke("retry_write", { value: 1 })).ok, true);
      assert.equal((await s.invoke("retry_write", { value: 1 })).ok, true);
      assert.equal(calls, 5);
    }
  });

test("resource-family changes are allowed after missing-ID guesses", async () => {
  const s = fixture();
  for (const id of ["missing_a", "missing_b"])
    await s.call("inspect_resource", {
      uri: `${base}/components/workspace/${id}`,
    });
  assert.equal(
    (await s.call("inspect_resource", { uri: `${base}/interface` })).ok,
    true,
  );
  assert.equal(
    (
      await s.call("inspect_resource", {
        uri: `${base}/components/workspace/missing_c`,
      })
    ).error.code,
    "not_found",
  );
});

test("schema feedback enables required discovery and corrected invocation in the next provider request", async () => {
  const { AgentOrchestrator } =
    await import("../apps/web/src/features/agent/server/orchestrator");
  const s = fixture();
  let requests = 0;
  let finished: any;
  const args = {
    workspaceId,
    name: "Movies",
    fields: [{ key: "title", label: "Title", type: "string", required: true }],
  };
  const provider: import("../apps/web/src/features/providers/public").ModelProvider =
    {
      id: "fixture",
      capabilities: { streaming: true, tools: true, hostedMcp: false },
      async *stream(request) {
        const invoke = {
          type: "call" as const,
          id: `invoke-${requests}`,
          name: "invoke_tool",
          args: { toolId: "create_collection", arguments: args },
        };
        if (requests++ === 0) yield invoke;
        else if (requests === 2) {
          const last = (request.messages.at(-1)!.content as any)[0].output
            .value;
          assert.equal(last.error.code, "schema_required");
          assert.deepEqual(last.error.inputSchema.required, [
            "workspaceId",
            "name",
            "fields",
          ]);
          yield {
            type: "call",
            id: "required-discovery",
            name: last.error.nextAction.tool,
            args: last.error.nextAction.arguments,
          };
          yield invoke;
        } else {
          assert.equal(
            (request.messages.at(-1)!.content as any)[0].output.value.ok,
            true,
          );
          yield { type: "text", text: "Collection creation confirmed." };
        }
        yield { type: "usage", input: 10, output: 5, reason: "stop" };
      },
    };
  await new AgentOrchestrator(provider, s.executor, {
    event: async () => true,
    finish: async (...args) => {
      finished = args;
    },
  }).run(
    {
      turnId: workspaceId,
      workspaceId,
      conversationId: collectionId,
      model: "fixture",
      apiKey: "unit-only",
      history: [{ role: "user", content: "Create a collection" }],
      signal: new AbortController().signal,
    },
    () => {},
  );
  assert.equal(requests, 3);
  assert.equal(s.writes(), 1);
  assert.equal(finished[1], "completed");
});

test("temporary discovery authorization-check failures remain retryable and reveal no schema", async () => {
  const s = fixture();
  const original = s.service.workspace;
  s.service.workspace = async () => {
    throw new ServiceError("Temporary database failure", 503);
  };
  const failed = await s.executor.schemaRecovery("create_collection", {});
  assert.ok(
    !failed.ok &&
      failed.error.code === "operation_failed" &&
      !failed.error.inputSchema,
  );
  s.service.workspace = original;
  const recovered = await s.executor.schemaRecovery("create_collection", {});
  assert.ok(!recovered.ok && recovered.error.code === "schema_required");
});

test("meaningful inspection clears failed identical-call counts without disabling successful-read repetition bounds", async () => {
  const s = fixture();
  for (let index = 0; index < 5; index++)
    await s.call("inspect_resource", { uri: `${base}/collection/guess` });
  assert.equal(
    (await s.call("inspect_resource", { uri: `${base}/interface` })).ok,
    true,
  );
  assert.equal(
    (await s.call("inspect_resource", { uri: `${base}/collection/guess` }))
      .error.code,
    "resource_invalid",
  );
  const fresh = fixture();
  for (let index = 0; index < 3; index++)
    assert.equal(
      (await fresh.call("inspect_resource", { uri: `${base}/interface` })).ok,
      true,
    );
  assert.equal(
    (await fresh.call("inspect_resource", { uri: `${base}/interface` })).error
      .code,
    "repeated_operation",
  );
});

test("a resource listing URI is a recovery action, not another guessed resource ID", async () => {
  const s = fixture();
  for (const id of [privateId, workspaceId])
    await s.call("inspect_resource", { uri: `${base}/collections/${id}` });
  assert.equal(
    (await s.call("inspect_resource", { uri: `${base}/collections` })).ok,
    true,
  );
  assert.equal(
    (
      await s.call("inspect_resource", {
        uri: `${base}/collections/${collectionId}`,
      })
    ).ok,
    true,
  );
});
