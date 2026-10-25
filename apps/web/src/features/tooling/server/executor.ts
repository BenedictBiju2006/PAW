import "server-only";
import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import { ToolGuidanceError, compactSchema } from "./recovery";
import type { ToolRegistry } from "./registry";
import type { ToolContext, ToolResult, SchemaDisclosure } from "./types";
export class ToolExecutor<Services = unknown> {
  private receipts = new WeakMap<ToolResult, SchemaDisclosure[]>();
  disclosures(result: ToolResult) {
    return this.receipts.get(result) ?? [];
  }
  constructor(
    readonly registry: ToolRegistry<Services>,
    private context: ToolContext<Services>,
  ) {}
  async discoveryAccess(
    id: string,
    args: Record<string, unknown> = {},
  ): Promise<Extract<ToolResult, { ok: false }> | undefined> {
    const tool = this.registry.resolve(id);
    if (!tool)
      return failure(
        "unknown_tool",
        "Unknown tool identifier.",
        "Use search_tools, then describe_tool.",
      );
    if (
      tool.requiredPermissions.some(
        (permission) => !this.context.permissions.has(permission),
      )
    )
      return failure(
        "forbidden",
        "This execution context does not grant the required permissions.",
        "Use search_tools to find authorized capabilities.",
      );
    try {
      return (
        (await this.registry.authorize?.(args, id, this.context)) ?? undefined
      );
    } catch (error) {
      if (error instanceof ServiceError && [403, 404].includes(error.status))
        return failure(
          "forbidden",
          "Discovery is not authorized in this workspace context.",
          "Use an authorized workspace.",
        );
      return failure(
        "operation_failed",
        "Tool discovery could not be checked.",
        "Retry the discovery step when the service is available.",
      );
    }
  }
  async schemaRecovery(
    id: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const denied = await this.discoveryAccess(id, args);
    if (denied) return denied;
    const tool = this.registry.resolve(id)!;
    return {
      ok: false,
      error: {
        code: "schema_required",
        message:
          "This tool schema has not been disclosed in this turn or has changed; it was not executed.",
        guidance:
          "Receive its schema through discovery, then invoke it using the current schema.",
        nextAction: { tool: "describe_tool", arguments: { toolId: id } },
        inputSchema: compactSchema(
          z.toJSONSchema(tool.inputSchema, { io: "input" }),
        ),
      },
    };
  }
  async execute(
    id: string,
    input: unknown,
    disclosure?: { schemaVersion: string; previousResult?: ToolResult },
  ): Promise<ToolResult> {
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
      if (
        disclosure &&
        disclosure.schemaVersion !== this.registry.schemaVersion(id)
      )
        return this.schemaRecovery(id, input as Record<string, unknown>);
      const args = tool.inputSchema.parse(input);
      const denied = await this.registry.authorize?.(args, id, this.context);
      if (denied) return denied;
      if (
        tool.sideEffects === "destructive" &&
        !(await this.context.authorizeDestructive?.(id, structuredClone(args)))
      )
        return failure(
          "confirmation_required",
          "Explicit user confirmation is required for this exact operation.",
          "Ask the user to use the manual delete control. A model-supplied Boolean cannot grant approval.",
        );
      // Recheck after asynchronous authorization/confirmation; a stale receipt
      // cannot authorize a changed schema or permission contract.
      if (
        disclosure &&
        disclosure.schemaVersion !== this.registry.schemaVersion(id)
      )
        return this.schemaRecovery(id, args);
      if (disclosure?.previousResult) return disclosure.previousResult;
      const result: ToolResult = {
        ok: true,
        data: (await tool.handler(args, this.context)) ?? null,
      };
      if (tool.policy.disclosure) {
        const disclosures = this.registry.confirmDisclosures(result.data);
        const allowed = await Promise.all(
          disclosures.map(async (receipt) =>
            (await this.discoveryAccess(receipt.id)) ? null : receipt,
          ),
        );
        this.receipts.set(
          result,
          allowed.filter(
            (receipt): receipt is SchemaDisclosure => receipt !== null,
          ),
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ToolGuidanceError)
        return { ok: false, error: error.feedback };
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
function failure(
  code: string,
  message: string,
  guidance: string,
): Extract<ToolResult, { ok: false }> {
  return { ok: false, error: { code, message, guidance } };
}
