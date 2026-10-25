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
  // Intentional additive UI authoring capabilities. Keep the original 22-tool
  // fixture untouched. Only the two explicitly improved discovery descriptions
  // differ; schemas, permissions and all other legacy metadata stay identical.
  const additions = [
    "search_ui_components",
    "add_ui_components",
    "update_ui_component",
  ];
  assert.deepEqual(
    registry
      .summaries()
      .filter((t) => additions.includes(t.id))
      .map((t) => t.id)
      .sort(),
    [...additions].sort(),
  );
  const actual = registry
    .summaries()
    .filter((tool) => !additions.includes(tool.id))
    .map((tool) => registry.describe(tool.id));
  const order = (tools: { id: string }[]) =>
    tools.sort((a, b) => a.id.localeCompare(b.id));
  const descriptionUpdates: Record<string, string> = {
    inspect_resource:
      "Read an existing authorized paw:// resource. For UI component types, schemas and examples use search_ui_components or inspect_component; describe_tool is still required before invoking a capability.",
    inspect_component:
      "Inspect a UI component type: official property schema plus a minimal valid authoring example. Use search_ui_components to find types; inspect_resource reads existing workspace resources.",
  };
  const expected = baseline.map((tool: { id: string }) => ({
    ...tool,
    ...(descriptionUpdates[tool.id]
      ? { description: descriptionUpdates[tool.id] }
      : {}),
  }));
  assert.deepEqual(order(JSON.parse(JSON.stringify(actual))), order(expected));
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
