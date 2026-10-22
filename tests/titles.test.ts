import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateConversationTitle,
  normalizeTitle,
  fallbackTitle,
} from "../apps/web/src/features/chat/server/titles";
import type { ModelProvider } from "../apps/web/src/features/providers/public";
const actor = "11111111-1111-4111-8111-111111111111";
function fixture(output: string | Error) {
  let calls = 0;
  const completed: Record<string, unknown>[] = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_conversation_title")
        return {
          data: {
            text: "Can you build an expense tracker? " + "x".repeat(1150),
            revision: 0,
          },
          error: null,
        };
      completed.push(args);
      return { data: { id: actor, title: args.new_title }, error: null };
    },
  } as unknown as SupabaseClient;
  const provider: ModelProvider = {
    id: "google",
    capabilities: { streaming: true, tools: true, hostedMcp: false },
    async *stream(input) {
      calls++;
      assert.deepEqual(input.tools, {});
      assert.equal(input.messages.length, 1);
      assert.equal(input.maxOutputTokens, 64);
      assert.equal(input.model, "selected-model");
      assert.equal(input.apiKey, "selected-key");
      assert.ok(input.messages[0].content.length < 1300);
      assert.ok(!input.system.includes("invoke_tool"));
      assert.ok(!input.system.includes("selected-key"));
      if (output instanceof Error) throw output;
      yield { type: "text", text: output };
    },
  };
  return { admin, provider, completed, calls: () => calls };
}
test("title generation uses only the selected provider and a small tool-free request", async () => {
  const f = fixture('"Monthly Expense Tracker."');
  const result = await generateConversationTitle({
    admin: f.admin,
    actor,
    workspaceId: actor,
    conversationId: actor,
    resolve: async () => ({
      provider: f.provider,
      model: "selected-model",
      apiKey: "selected-key",
    }),
  });
  assert.equal(result?.title, "Monthly Expense Tracker");
  assert.equal(f.calls(), 1);
  assert.equal(f.completed[0].generated, true);
});
test("title failure falls back once without provider switches or failing chat", async () => {
  for (const output of [
    new Error("429 quota"),
    "Here is my reasoning\nExpense tracker",
    "",
    "Chat About Something",
  ]) {
    const f = fixture(output);
    await generateConversationTitle({
      admin: f.admin,
      actor,
      workspaceId: actor,
      conversationId: actor,
      resolve: async () => ({
        provider: f.provider,
        model: "selected-model",
        apiKey: "selected-key",
      }),
    });
    assert.equal(f.calls(), 1);
    assert.equal(f.completed[0].generated, false);
    assert.equal(f.completed[0].new_title, "Can you build an expense tracker");
  }
});
test("an ineligible or already claimed title makes no inference request", async () => {
  let calls = 0;
  const admin = {
    async rpc() {
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  const result = await generateConversationTitle({
    admin,
    actor,
    workspaceId: actor,
    conversationId: actor,
    resolve: async () => {
      calls++;
      throw Error("must not resolve keys");
    },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});
test("title normalization rejects explanations and bounds fallback output", () => {
  assert.equal(
    normalizeTitle("# Monthly Spending Trends!"),
    "Monthly Spending Trends",
  );
  assert.equal(normalizeTitle("a".repeat(101)), null);
  assert.equal(normalizeTitle("Reasoning\nActual title"), null);
  assert.ok(fallbackTitle("a".repeat(500)).length <= 100);
  assert.equal(fallbackTitle(" \n "), "New conversation");
});
