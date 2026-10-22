import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createToolRegistry } from "../apps/web/src/composition/tools";

test("feature registration preserves the complete pre-refactor tool contract", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("./tool-contract-baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const registry = createToolRegistry();
  const actual = registry.summaries().map((tool) => registry.describe(tool.id));
  const order = (tools: { id: string }[]) =>
    tools.sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(order(JSON.parse(JSON.stringify(actual))), order(baseline));
});

test("feature boundaries exclude runtime cycles and privileged client dependencies", () => {
  assert.match(
    execFileSync(process.execPath, ["scripts/check-boundaries.mjs"], {
      encoding: "utf8",
    }),
    /Architecture boundaries passed/,
  );
});

test("injected scope policy preserves existing denial responses", async () => {
  const { createWorkspaceServices } =
    await import("../apps/web/src/composition/services");
  const { createClient } = await import("@supabase/supabase-js");
  const { ToolExecutor } =
    await import("../apps/web/src/features/tooling/server/public");
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const service = createWorkspaceServices(
    createClient("http://127.0.0.1:1", "test-only"),
    workspaceId,
  );
  service.workspace = async () => ({ id: workspaceId });
  const executor = new ToolExecutor(createToolRegistry(), {
    service,
    workspaceId,
    permissions: new Set(["read", "write"]),
  });
  assert.deepEqual(
    await executor.execute("list_collections", {
      workspaceId: "22222222-2222-4222-8222-222222222222",
    }),
    {
      ok: false,
      error: {
        code: "forbidden",
        message: "Tool targets a different workspace.",
        guidance: "Use the current workspace identity.",
      },
    },
  );
  assert.deepEqual(
    await executor.execute("create_workspace", { name: "Blocked" }),
    {
      ok: false,
      error: {
        code: "forbidden",
        message: "Cannot create workspaces in a workspace-scoped session.",
        guidance: "Use an account-scoped session.",
      },
    },
  );
});
