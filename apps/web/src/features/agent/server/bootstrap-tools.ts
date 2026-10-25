import { tool, type ToolSet } from "ai";
import "server-only";
import { z } from "zod";
import type { ExecutionTools } from "../../tooling/public";
export const dispatch = z
  .object({
    toolId: z.string().max(100),
    arguments: z.record(z.string(), z.json()),
  })
  .strict();

export function bootstrapTools(executor: ExecutionTools) {
  const tools: ToolSet = {};
  for (const definition of executor.registry.bootstrap()) {
    tools[definition.id] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
    });
  }
  tools.invoke_tool = tool({
    description:
      "Invoke a capability after its schema was returned through discovery in this turn. Permissions and confirmation remain enforced by PAW.",
    inputSchema: dispatch,
  });

  return tools;
}

export function decodeInvocation(call: { name: string; args: unknown }) {
  if (call.name === "invoke_tool") {
    const parsed = dispatch.safeParse(call.args);
    if (!parsed.success)
      return {
        ok: false as const,
        error: {
          code: "invalid_arguments",
          message: "invoke_tool requires a toolId and arguments object.",
          guidance: "Use the invocation schema.",
        },
      };
    return {
      ok: true as const,
      toolId: parsed.data.toolId,
      args: parsed.data.arguments,
    };
  }
  if (!call.args || typeof call.args !== "object" || Array.isArray(call.args))
    return {
      ok: false as const,
      error: {
        code: "invalid_arguments",
        message: "Expected an arguments object.",
        guidance: "Use the tool schema.",
      },
    };
  return {
    ok: true as const,
    toolId: call.name,
    args: call.args as Record<string, unknown>,
  };
}
