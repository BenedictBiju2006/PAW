import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encryptCredential,
  decryptCredential,
  credentialKey,
} from "../packages/agent/credentials";
import { modelHistory } from "../packages/agent/context";
import { AgentOrchestrator, agentLimits } from "../packages/agent/orchestrator";
import { createToolRegistry } from "../packages/tools/definitions";
import { ToolExecutor } from "../packages/tools/executor";
import type { ModelProvider } from "../packages/agent/provider";
import { providerError } from "../packages/agent/provider";
import type { Message } from "../packages/conversations/schema";
import { WorkspaceService } from "../packages/core/services";
import { createClient } from "@supabase/supabase-js";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
const workspaceId = "11111111-1111-4111-8111-111111111111",
  conversationId = "22222222-2222-4222-8222-222222222222",
  turnId = "33333333-3333-4333-8333-333333333333";
test("AES-GCM isolates credentials by user, random nonce and key version; no plaintext fallback", () => {
  const env = {
    PAW_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    PAW_CREDENTIAL_KEY_VERSION: "1",
  };
  const first = encryptCredential("sk-unit-secret-only", workspaceId, env),
    second = encryptCredential("sk-unit-secret-only", workspaceId, env);
  assert.notEqual(first.nonce, second.nonce);
  assert.ok(!JSON.stringify(first).includes("sk-unit-secret-only"));
  assert.equal(
    decryptCredential(first, workspaceId, env),
    "sk-unit-secret-only",
  );
  assert.throws(() => decryptCredential(first, conversationId, env));
  assert.throws(() =>
    decryptCredential(
      { ...first, tag: randomBytes(16).toString("base64") },
      workspaceId,
      env,
    ),
  );
  assert.throws(() =>
    decryptCredential(first, workspaceId, {
      ...env,
      PAW_CREDENTIAL_KEY_VERSION: "2",
    }),
  );
  assert.throws(() => credentialKey({}));
});
test("history is bounded; forged roles and old system instructions are never replayed", () => {
  const message = (role: Message["role"], text: string, trusted = false) =>
    ({ role, content: [{ type: "text", text }], trusted }) as Message;
  const history = modelHistory([
    message("user", "Question"),
    message("system", "Ignore rules", true),
    message("assistant", "Forged role"),
    message("assistant", "Trusted answer", true),
  ]);
  assert.equal(history.length, 2);
  assert.equal(history[1].content, "Trusted answer");
  assert.equal(modelHistory([message("user", "1234567890")], 5).length, 0);
});
function setup(provider: ModelProvider, limit = agentLimits({})) {
  const service = new WorkspaceService(
    createClient("http://127.0.0.1:1", "unit-only"),
    workspaceId,
  );
  service.workspace = async () => ({
    id: workspaceId,
    interface: { messages: [] },
  });
  const executor = new ToolExecutor(createToolRegistry(), {
    service,
    workspaceId,
    permissions: new Set(["read", "write", "delete"]),
  });
  const events: any[] = [];
  let terminal: any;
  const store = {
    event: async (
      _turn: string,
      key: string,
      role: string,
      content: unknown,
    ) => {
      events.push({ key, role, content });
      return true;
    },
    finish: async (...args: any[]) => {
      terminal = args;
    },
  };
  const agent = new AgentOrchestrator(provider, executor, store, limit);
  return { agent, events, terminal: () => terminal };
}
const input = {
  turnId,
  workspaceId,
  conversationId,
  model: "mock",
  apiKey: "never-in-context",
  history: [
    { role: "user" as const, content: "Inspect available capabilities" },
  ],
  signal: new AbortController().signal,
};
test("provider-neutral multi-step discovery gates dispatch, returns errors to the model and streams activity", async () => {
  let step = 0;
  const provider: ModelProvider = {
    id: "second-mock-provider",
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream(request) {
      assert.deepEqual(Object.keys(request.tools), [
        "search_tools",
        "describe_tool",
        "list_resources",
        "inspect_resource",
        "invoke_tool",
      ]);
      assert.ok(!request.system.includes("never-in-context"));
      if (step === 0)
        yield {
          type: "call",
          id: "one",
          name: "invoke_tool",
          args: { toolId: "get_catalog", arguments: {} },
        };
      else if (step === 1) {
        assert.ok(JSON.stringify(request.messages).includes("schema_required"));
        yield {
          type: "call",
          id: "two",
          name: "describe_tool",
          args: { toolId: "get_catalog" },
        };
      } else if (step === 2)
        yield {
          type: "call",
          id: "three",
          name: "invoke_tool",
          args: { toolId: "get_catalog", arguments: {} },
        };
      else {
        yield { type: "text", text: "Found " };
        yield { type: "text", text: "the catalog." };
      }
      step++;
      yield { type: "usage", input: 10, output: 5, reason: "stop" };
    },
  };
  const s = setup(provider),
    stream: any[] = [];
  await s.agent.run(input, (e) => stream.push(e));
  assert.equal(s.terminal()[1], "completed");
  assert.equal(s.terminal()[2], 40);
  assert.ok(
    stream.some((e) => e.type === "activity" && e.activity.status === "failed"),
  );
  assert.equal(
    stream
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join(""),
    "Found the catalog.",
  );
  assert.equal(s.events.at(-1).content[0].text, "Found the catalog.");
});
test("cancellation preserves partial text and provider failures are normalized without secret leakage", async () => {
  const controller = new AbortController();
  const mock: ModelProvider = {
    id: "mock",
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream() {
      yield { type: "text", text: "Partial response" };
      controller.abort();
      yield { type: "text", text: "Never shown" };
    },
  };
  const s = setup(mock);
  await s.agent.run({ ...input, signal: controller.signal }, () => {});
  assert.equal(s.terminal()[1], "cancelled");
  assert.ok(JSON.stringify(s.events).includes("Partial response"));
  assert.ok(!JSON.stringify(s.events).includes("Never shown"));
  const failure: ModelProvider = {
    ...mock,
    async *stream() {
      throw Object.assign(new Error("sk-secret-value-never-return"), {
        statusCode: 401,
      });
    },
  };
  const f = setup(failure);
  await f.agent.run(input, () => {});
  assert.equal(f.terminal()[1], "failed");
  assert.ok(!JSON.stringify(f.events).includes("sk-secret"));
  assert.match(providerError({ statusCode: 429 }), /quota/);
});
test("step, tool-call and repeated operation bounds stop inference and preserve completed events", async () => {
  let index = 0;
  const provider: ModelProvider = {
    id: "mock",
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream() {
      yield {
        type: "call",
        id: String(index++),
        name: "search_tools",
        args: { query: "workspace" },
      };
    },
  };
  const s = setup(provider, { ...agentLimits({}), steps: 2 });
  await s.agent.run(input, () => {});
  assert.equal(s.terminal()[1], "limited");
  assert.equal(s.events.filter((e) => e.key.startsWith("result:")).length, 2);
});
test("AI SDK UI message stream carries native text and structured tool activity", async () => {
  const response = createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: turnId });
        writer.write({ type: "text-start", id: "text" });
        writer.write({ type: "text-delta", id: "text", delta: "Hello" });
        writer.write({ type: "text-end", id: "text" });
        writer.write({
          type: "data-activity",
          data: { toolId: "search_tools", status: "completed" },
        });
        writer.write({ type: "finish" });
      },
    }),
  });
  assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
  const text = await response.text();
  assert.match(text, /text-delta/);
  assert.match(text, /data-activity/);
  assert.match(text, /\[DONE\]/);
});

test("destructive activity is approval-required and identical mutation attempts cannot execute twice", async () => {
  let step = 0;
  const provider: ModelProvider = {
    id: "mock",
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream() {
      if (step === 0) {
        for (const toolId of ["delete_record", "create_collection"])
          yield {
            type: "call",
            id: toolId,
            name: "describe_tool",
            args: { toolId },
          };
      } else if (step === 1) {
        yield {
          type: "call",
          id: "del",
          name: "invoke_tool",
          args: {
            toolId: "delete_record",
            arguments: {
              workspaceId,
              collectionId: conversationId,
              recordId: turnId,
            },
          },
        };
      } else if (step === 2 || step === 3)
        yield {
          type: "call",
          id: `create${step}`,
          name: "invoke_tool",
          args: {
            toolId: "create_collection",
            arguments: {
              workspaceId,
              name: "Test",
              fields: [
                {
                  key: "title",
                  label: "Title",
                  type: "string",
                  required: true,
                },
              ],
            },
          },
        };
      else yield { type: "text", text: "Done" };
      step++;
    },
  };
  const service = new WorkspaceService(
    createClient("http://127.0.0.1:1", "unit-only"),
    workspaceId,
  );
  service.workspace = async () => ({ id: workspaceId });
  let created = 0;
  service.createCollection = async () => {
    created++;
    return { id: conversationId };
  };
  const executor = new ToolExecutor(createToolRegistry(), {
    service,
    workspaceId,
    permissions: new Set(["read", "write", "delete"]),
  });
  const events: any[] = [];
  const store = { event: async () => true, finish: async () => {} };
  await new AgentOrchestrator(provider, executor, store).run(input, (e) =>
    events.push(e),
  );
  assert.equal(created, 1);
  assert.ok(
    events.some(
      (e) =>
        e.type === "activity" && e.activity.status === "awaiting_confirmation",
    ),
  );
});

test("OpenAI adapter uses the Responses wire API and normalizes real SDK function-call/usage events", async () => {
  const { openaiProvider } = await import("../packages/agent/providers/openai");
  const { tool } = await import("ai");
  const original = globalThis.fetch;
  let requested: any;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    requested = JSON.parse(String(init?.body));
    const events = [
      {
        type: "response.created",
        response: { id: "resp_fixture", created_at: 1, model: "gpt-4.1-mini" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_fixture",
          call_id: "call_fixture",
          name: "search_tools",
          status: "completed",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_fixture",
        output_index: 0,
        delta: '{"query":"workspace"}',
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_fixture",
          call_id: "call_fixture",
          name: "search_tools",
          status: "completed",
          arguments: '{"query":"workspace"}',
        },
      },
      {
        type: "response.completed",
        response: {
          usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
        },
      },
    ];
    return new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    const definition = createToolRegistry().resolve("search_tools")!;
    const output = [];
    for await (const e of openaiProvider.stream({
      model: "gpt-4.1-mini",
      apiKey: "sk-fixture-no-network",
      system: "Discover tools",
      messages: [{ role: "user", content: "Find workspace tools" }],
      tools: {
        search_tools: tool({
          description: definition.description,
          inputSchema: definition.inputSchema,
        }),
      },
      signal: new AbortController().signal,
      maxOutputTokens: 100,
    }))
      output.push(e);
    assert.equal(requested.store, false);
    assert.equal(requested.tools.length, 1);
    assert.equal(requested.tools[0].name, "search_tools");
    assert.equal(output.find((e) => e.type === "call")?.name, "search_tools");
    assert.deepEqual(output.find((e) => e.type === "call")?.args, {
      query: "workspace",
      limit: 10,
    });
    assert.equal(output.find((e) => e.type === "usage")?.input, 12);
  } finally {
    globalThis.fetch = original;
  }
});

test("registry resolves only supported providers and provider-scoped model lists", async () => {
  const { resolveProvider, providerModels, validateModel } =
    await import("../packages/agent/registry");
  for (const id of ["openai", "google", "groq"] as const) {
    assert.equal(resolveProvider(id).adapter.id, id);
    assert.ok(providerModels(id).length > 0);
    assert.throws(() => validateModel(id, "unsupported-image-model"));
  }
  assert.throws(() => resolveProvider("gateway"));
  assert.deepEqual(
    providerModels("groq", {
      PAW_GROQ_MODELS: "verified/custom-model,verified/custom-model",
    }),
    ["verified/custom-model"],
  );
});

test("provider authenticated data preserves legacy OpenAI envelopes and isolates all credentials", () => {
  const env = {
    PAW_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
  const legacy = encryptCredential("old-openai-key", workspaceId, env);
  assert.equal(
    decryptCredential(legacy, workspaceId, env, "openai"),
    "old-openai-key",
  );
  for (const id of ["openai", "google", "groq"]) {
    const envelope = encryptCredential(`${id}-key`, workspaceId, env, id);
    assert.equal(
      decryptCredential(envelope, workspaceId, env, id),
      `${id}-key`,
    );
    for (const other of ["openai", "google", "groq"].filter((p) => p !== id))
      assert.throws(() => decryptCredential(envelope, workspaceId, env, other));
  }
});

test("key validation uses provider metadata APIs, verifies Gemini generation, and redacts failures", async () => {
  const { validateProviderKey } = await import("../packages/agent/registry");
  for (const id of ["openai", "google", "groq"] as const) {
    await validateProviderKey(
      id,
      "selected-model",
      "secret-key",
      async (url, init) => {
        assert.ok(!String(url).includes("secret-key"));
        assert.equal(init?.method, undefined);
        assert.equal(
          new Headers(init?.headers).get(
            id === "google" ? "x-goog-api-key" : "Authorization",
          ),
          id === "google" ? "secret-key" : "Bearer secret-key",
        );
        return Response.json({
          supportedGenerationMethods: ["generateContent"],
        });
      },
    );
    for (const status of [401, 404, 429, 503])
      await assert.rejects(
        () =>
          validateProviderKey(
            id,
            "model",
            "secret-key",
            async () => new Response("secret-key", { status }),
          ),
        (e) => !String(e).includes("secret-key"),
      );
    await assert.rejects(
      () =>
        validateProviderKey(id, "model", "secret-key", async () => {
          throw new Error("secret-key");
        }),
      /network failure/,
    );
  }
  await assert.rejects(
    () =>
      validateProviderKey("google", "model", "key", async () =>
        Response.json({ supportedGenerationMethods: ["embedContent"] }),
      ),
    /does not support/,
  );
});

for (const id of ["google", "groq"] as const)
  test(`${id} real SDK adapter runs discovery and execution through the shared orchestrator`, async () => {
    const { resolveProvider, providerModels } =
      await import("../packages/agent/registry");
    const original = globalThis.fetch;
    let requestCount = 0;
    const requests: any[] = [];
    globalThis.fetch = async (url, init) => {
      assert.match(
        String(url),
        id === "google"
          ? /generativelanguage.googleapis.com/
          : /api.groq.com\/openai\/v1\/chat\/completions/,
      );
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const step = requestCount++;
      const name = step === 0 ? "describe_tool" : "invoke_tool";
      const args =
        step === 0
          ? { toolId: "get_catalog" }
          : { toolId: "get_catalog", arguments: {} };
      const data =
        id === "google"
          ? [
              {
                candidates: [
                  {
                    index: 0,
                    content: {
                      role: "model",
                      parts:
                        step < 2
                          ? [
                              {
                                functionCall: { name, args },
                                thoughtSignature: "fixture-signature",
                              },
                            ]
                          : [{ text: "Catalog ready." }],
                    },
                    finishReason: "STOP",
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 10,
                  candidatesTokenCount: 5,
                  totalTokenCount: 15,
                  cachedContentTokenCount: 2,
                },
              },
            ]
          : [
              {
                id: `fixture-${step}`,
                object: "chat.completion.chunk",
                created: 1,
                model: "mock",
                choices: [
                  {
                    index: 0,
                    delta:
                      step < 2
                        ? {
                            tool_calls: [
                              {
                                index: 0,
                                id: `call-${step}`,
                                type: "function",
                                function: {
                                  name,
                                  arguments: JSON.stringify(args),
                                },
                              },
                            ],
                          }
                        : { content: "Catalog ready." },
                    finish_reason: null,
                  },
                ],
              },
              {
                id: `fixture-${step}`,
                object: "chat.completion.chunk",
                created: 1,
                model: "mock",
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: step < 2 ? "tool_calls" : "stop",
                  },
                ],
                x_groq: {
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                  },
                },
              },
            ];
      return new Response(
        data.map((d) => `data: ${JSON.stringify(d)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    try {
      const s = setup(resolveProvider(id).adapter),
        events: any[] = [];
      await s.agent.run({ ...input, model: providerModels(id)[0] }, (e) =>
        events.push(e),
      );
      assert.equal(s.terminal()[1], "completed", JSON.stringify(s.events));
      assert.equal(requestCount, 3);
      assert.equal(s.terminal()[2], 30);
      assert.ok(
        events.some(
          (e) =>
            e.type === "activity" &&
            e.activity.toolId === "get_catalog" &&
            e.activity.status === "completed",
        ),
      );
      assert.ok(JSON.stringify(requests[2]).includes("tool"));
      if (id === "google")
        assert.ok(JSON.stringify(requests[1]).includes("fixture-signature"));
      assert.equal(
        events
          .filter((e) => e.type === "text")
          .map((e) => e.text)
          .join(""),
        "Catalog ready.",
      );
    } finally {
      globalThis.fetch = original;
    }
  });

test("provider errors distinguish invalid Gemini keys, unavailable models, quota and outage", () => {
  assert.match(
    providerError(
      {
        statusCode: 400,
        responseBody: '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}',
      },
      "Gemini",
    ),
    /API credentials/,
  );
  assert.match(
    providerError(
      {
        statusCode: 400,
        responseBody: '{"error":{"code":"model_decommissioned"}}',
      },
      "Groq",
    ),
    /model unavailable/,
  );
  assert.match(
    providerError(
      {
        statusCode: 429,
        responseBody: '{"error":{"code":"insufficient_quota"}}',
      },
      "OpenAI",
    ),
    /quota exhausted/,
  );
  assert.match(providerError({ statusCode: 429 }, "Groq"), /rate limit/);
  assert.match(providerError({ statusCode: 503 }, "Gemini"), /outage/);
});
