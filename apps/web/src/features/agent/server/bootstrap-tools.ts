import { tool, type ToolSet } from "ai";
import "server-only";
import { z } from "zod";
import type { ExecutionTools } from "../../tooling/public";
const bootstrap = [
  "search_tools",
  "describe_tool",
  "list_resources",
  "inspect_resource",
];
export const dispatch = z
  .object({
    toolId: z.string().max(100),
    arguments: z.record(z.string(), z.json()),
  })
  .strict();

export function bootstrapTools(executor: ExecutionTools) {
  const tools: ToolSet = {};
  for (const id of bootstrap) {
    const definition = executor.registry.resolve(id)!;
    tools[id] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
    });
  }
  tools.invoke_tool = tool({
    description:
      "Invoke a discovered capability after describe_tool has returned its schema in this turn. Permissions and confirmation remain enforced by PAW.",
    inputSchema: dispatch,
  });

  return tools;
}
