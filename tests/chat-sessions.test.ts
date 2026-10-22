import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatSessions } from "../apps/web/src/features/chat/client/sessions";
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(check());
}
test("external SDK sessions keep independent streams alive until explicitly stopped", async () => {
  const original = globalThis.fetch;
  const controllers = new Map<
      string,
      ReadableStreamDefaultController<Uint8Array>
    >(),
    aborted: string[] = [];
  const encoder = new TextEncoder();
  const chunk = (id: string, value: unknown) =>
    controllers
      .get(id)!
      .enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)),
      id = body.conversationId;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.set(id, controller);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "start", messageId: body.turnId })}\n\ndata: ${JSON.stringify({ type: "text-start", id: "text" })}\n\n`,
          ),
        );
        init?.signal?.addEventListener("abort", () => {
          aborted.push(id);
          try {
            controller.error(new DOMException("Stopped", "AbortError"));
          } catch {}
        });
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  };
  const sessions = new ChatSessions();
  try {
    const one = sessions.start("workspace-a", "one", "first", true),
      two = sessions.start("workspace-a", "two", "second", true);
    await until(() => controllers.size === 2);
    chunk("one", { type: "text-delta", id: "text", delta: "First response" });
    chunk("two", { type: "text-delta", id: "text", delta: "Second response" });
    await until(
      () => sessions.get("workspace-a", "one").chat.status === "streaming",
    );
    // Looking up a different workspace/view never disposes the original session.
    sessions.get("workspace-b", "one");
    assert.notEqual(
      sessions.get("workspace-a", "one"),
      sessions.get("workspace-b", "one"),
    );
    assert.deepEqual(aborted, []);
    assert.equal(
      sessions.get("workspace-a", "one").currentTurn,
      sessions.get("workspace-a", "one").lastRequest?.turnId,
    );
    await sessions.get("workspace-a", "two").chat.stop();
    await two;
    assert.deepEqual(aborted, ["two"]);
    assert.equal(sessions.get("workspace-a", "one").chat.status, "streaming");
    chunk("one", { type: "text-end", id: "text" });
    chunk("one", { type: "finish" });
    controllers.get("one")!.enqueue(encoder.encode("data: [DONE]\n\n"));
    controllers.get("one")!.close();
    await one;
    assert.equal(sessions.get("workspace-a", "one").chat.status, "ready");
    assert.equal(sessions.get("workspace-a", "one").currentTurn, null);
    assert.ok(
      JSON.stringify(sessions.get("workspace-a", "one").chat.messages).includes(
        "First response",
      ),
    );
  } finally {
    sessions.reset();
    globalThis.fetch = original;
  }
});
