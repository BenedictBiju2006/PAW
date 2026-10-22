import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import type { ToolContext, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";
export class ToolExecutor<Services = unknown> {
  constructor(
    readonly registry: ToolRegistry<Services>,
    private context: ToolContext<Services>,
  ) {}
  async execute(id: string, input: unknown): Promise<ToolResult> {
    try {
      const tool = this.registry.resolve(id);
      if (!tool)
        return failure(
          "unknown_tool",
          "Unknown tool identifier.",
          "Use search_tools, then describe_tool.",
        );
      if (
        tool.requiredPermissions.some((p) => !this.context.permissions.has(p))
      )
        return failure(
          "forbidden",
          "This execution context does not grant the required permissions.",
          "Ask the application host for authorized access.",
        );
      const args = tool.inputSchema.parse(input);
      await this.registry.authorize?.(args,id,this.context);
      if (
        tool.sideEffects === "destructive" &&
        !(await this.context.authorizeDestructive?.(id, structuredClone(args)))
      )
        return failure(
          "confirmation_required",
          "Explicit user confirmation is required for this exact operation.",
          "Ask the user to use the manual delete control. A model-supplied Boolean cannot grant approval.",
        );
      return {
        ok: true,
        data: (await tool.handler(args, this.context)) ?? null,
      };
    } catch (error) {
      if (error instanceof z.ZodError)
        return {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: "Tool arguments failed validation.",
            issues: error.issues,
            guidance: "Inspect describe_tool and correct the indicated fields.",
          },
        };
      if (error instanceof ServiceError)
        return failure(
          error.status === 403
            ? "forbidden"
            : error.status === 404
            ? "not_found"
            : error.status === 409
              ? "conflict"
              : "operation_failed",
          error.message,
          "Inspect the current resource and retry with its current revision or schema.",
        );
      return failure(
        "operation_failed",
        "The operation could not be completed.",
        "Check the tool identifier or resource identifier and inspect its schema before retrying.",
      );
    }
  }
}
function failure(code: string, message: string, guidance: string): ToolResult {
  return { ok: false, error: { code, message, guidance } };
}
