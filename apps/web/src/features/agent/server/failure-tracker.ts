import "server-only";
import type { ToolResult } from "../../tooling/public";
type Failure = Extract<ToolResult, { ok: false }>;
type State = { tool: string; count: number; error: Failure["error"] };
/** Turn-local feedback only. Conflicts, temporary errors and confirmations are
 * deliberately excluded; corrected schema-valid arguments are always attempted. */
export class FailureTracker {
  private failures = new Map<string, State>();
  before(
    tool: string,
    args: Record<string, unknown>,
    schemaValid: boolean,
  ): Failure | undefined {
    for (const state of this.failures.values()) {
      if (state.tool !== tool || state.count < 2) continue;
      const code = state.error.code;
      let equivalent =
        ["invalid_arguments", "unknown_tool"].includes(code) && !schemaValid;
      if (tool === "inspect_resource" && code === "resource_invalid")
        equivalent =
          typeof args.uri !== "string" ||
          !state.error.validUriPattern ||
          !new RegExp(state.error.validUriPattern).test(args.uri);
      if (tool === "inspect_resource" && code === "not_found")
        equivalent =
          typeof args.uri === "string" &&
          (state.error.uriPatterns
            ?.filter((pattern) => pattern.includes("{"))
            .some((pattern) => matchesPattern(pattern, args.uri as string)) ??
            true);
      if (equivalent)
        return {
          ok: false,
          error: {
            ...state.error,
            code: "recovery_required",
            message: `Two related ${code} failures. This speculative call was not executed.`,
            guidance:
              "Perform nextAction before more equivalent attempts; corrected schema-valid arguments or a corrected URI shape can proceed.",
          },
        };
    }
  }
  observe(
    tool: string,
    args: Record<string, unknown>,
    result: ToolResult,
  ): ToolResult {
    if (result.ok) {
      this.clear(tool);
      if (tool === "describe_tool" && typeof args.toolId === "string")
        this.clear(args.toolId);
      if (tool === "list_resources") this.clear("inspect_resource");
      if (tool === "search_tools") {
        for (const [key, state] of this.failures)
          if (["unknown_tool", "forbidden"].includes(state.error.code))
            this.failures.delete(key);
      }
      if (tool === "search_ui_components") {
        for (const [key, state] of this.failures)
          if (
            state.error.nextAction?.arguments.toolId === "search_ui_components"
          )
            this.failures.delete(key);
      }
      return result;
    }
    const code = result.error.code;
    if (
      ![
        "invalid_arguments",
        "schema_required",
        "resource_invalid",
        "unknown_tool",
        "forbidden",
      ].includes(code) &&
      !(tool === "inspect_resource" && code === "not_found")
    )
      return result;
    const key = `${tool}:${code}`;
    const count = (this.failures.get(key)?.count ?? 0) + 1;
    const nextAction =
      result.error.nextAction ??
      (["unknown_tool", "forbidden"].includes(code)
        ? { tool: "search_tools", arguments: { query: "" } }
        : { tool: "describe_tool", arguments: { toolId: tool } });
    const error = { ...result.error, nextAction };
    this.failures.set(key, { tool, count, error });
    return count < 2
      ? { ok: false, error }
      : {
          ok: false,
          error: {
            ...error,
            guidance: `Two related ${code} failures. Perform nextAction instead of varying guesses. ${error.guidance}`,
          },
        };
  }
  private clear(tool: string) {
    for (const [key, state] of this.failures)
      if (state.tool === tool) this.failures.delete(key);
  }
}

function matchesPattern(template: string, uri: string) {
  const expression = template
    .split(/(\{[A-Za-z]+\})/)
    .map((part) =>
      /^\{[A-Za-z]+\}$/.test(part)
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${expression}$`).test(uri);
}
