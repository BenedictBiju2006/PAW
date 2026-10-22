import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiProvider } from "../apps/web/src/features/providers/server/adapters/openai";
test(
  "opt-in paid OpenAI Responses smoke",
  {
    skip:
      process.env.PAW_LIVE_OPENAI_SMOKE !== "1" || !process.env.OPENAI_API_KEY,
  },
  async () => {
    let text = "";
    for await (const event of openaiProvider.stream({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.PAW_LIVE_MODEL || "gpt-4.1-mini",
      system: "Reply briefly.",
      messages: [{ role: "user", content: "Say hello." }],
      tools: {},
      signal: AbortSignal.timeout(30000),
      maxOutputTokens: 50,
    })) {
      if (event.type === "text") text += event.text;
    }
    assert.ok(text.length > 0);
  },
);
