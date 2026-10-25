import "server-only";
import type { ToolResult, ToolPolicy } from "../../tooling/public";
type Failure = Extract<ToolResult, { ok: false }>;
type State = {
  tool: string;
  count: number;
  error: Failure["error"];
  group?: string;
};
/** Turn-local feedback only. Conflicts, temporary errors and confirmations are
 * deliberately excluded; corrected schema-valid arguments are always attempted. */
export class FailureTracker {
  private failures = new Map<string, State>();
  recovered: string[] = [];
  before(
    tool: string,
    args: Record<string, unknown>,
    schemaValid: boolean,
    policy: ToolPolicy = {},
  ): Failure | undefined {
    for (const state of this.failures.values()) {
      if (state.tool !== tool || state.count < 2) continue;
      const code = state.error.code;
      let equivalent =
        ["invalid_arguments", "unknown_tool"].includes(code) && !schemaValid;
      if (policy.failureArgument && code === "resource_invalid")
        equivalent =
          typeof args[policy.failureArgument!] !== "string" ||
          !state.error.validUriPattern ||
          !new RegExp(state.error.validUriPattern).test(
            args[policy.failureArgument!] as string,
          );
      if (policy.failureArgument && code === "not_found")
        equivalent =
          typeof args[policy.failureArgument!] === "string" &&
          (state.error.uriPatterns
            ?.filter((pattern) => pattern.includes("{"))
            .some((pattern) =>
              matchesPattern(pattern, args[policy.failureArgument!] as string),
            ) ??
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
    policy: ToolPolicy = {},
    disclosures: string[] = [],
  ): ToolResult {
    this.recovered = [];
    if (result.ok) {
      const recovered = new Set([tool, ...disclosures]);
      for (const [key, state] of this.failures) {
        const action = state.error.nextAction;
        if (
          state.tool === tool ||
          disclosures.includes(state.tool) ||
          (state.group && policy.clearsGroups?.includes(state.group)) ||
          policy.clearsErrorCodes?.includes(state.error.code) ||
          action?.tool === tool ||
          action?.arguments.toolId === tool
        ) {
          recovered.add(state.tool);
          this.failures.delete(key);
        }
      }
      this.recovered = [...recovered];
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
      !(policy.failureArgument && code === "not_found")
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
    this.failures.set(key, { tool, count, error, group: policy.failureGroup });
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
