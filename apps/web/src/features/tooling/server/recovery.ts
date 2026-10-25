import "server-only";
import { ServiceError } from "../../../shared/db/result";
import type { ToolResult } from "./types";
export type ToolFailure = Extract<ToolResult, { ok: false }>;
/** Explicit, trusted tool feedback; never populated from upstream exception bodies. */
export class ToolGuidanceError extends ServiceError {
  constructor(
    readonly feedback: ToolFailure["error"],
    status = 400,
  ) {
    super(feedback.message, status);
  }
}

/** A bounded hint, not a replacement for describe_tool or authoritative parsing. */
export function compactSchema(input: unknown): Record<string, unknown> {
  let remaining = 36;
  function visit(value: unknown, depth: number): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const schema = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of [
      "type",
      "format",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "additionalProperties",
    ]) {
      const entry = schema[key];
      if (
        typeof entry === "boolean" ||
        typeof entry === "number" ||
        typeof entry === "string"
      )
        result[key] = entry;
    }
    if (typeof schema.pattern === "string") {
      if (schema.pattern.length <= 160) result.pattern = schema.pattern;
      else result.patternDetails = "describe_tool";
    }
    if (Array.isArray(schema.enum)) {
      result.enum = schema.enum.slice(0, 16);
      if (schema.enum.length > 16) result.truncated = true;
    }
    if (schema.const !== undefined) result.const = schema.const;
    if (
      schema.default !== undefined &&
      JSON.stringify(schema.default).length < 100
    )
      result.default = schema.default;
    if (schema.$ref) return { type: "json", details: "describe_tool" };
    if (Array.isArray(schema.required)) result.required = schema.required;
    if (depth >= 3 || remaining <= 0)
      return { ...result, details: "describe_tool" };
    const properties = schema.properties;
    if (
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      result.properties = Object.fromEntries(
        Object.entries(properties)
          .slice(0, 16)
          .map(([key, child]) => {
            remaining--;
            return [key, visit(child, depth + 1)];
          }),
      );
      if (Object.keys(properties).length > 16) result.truncated = true;
    }
    if (schema.items) result.items = visit(schema.items, depth + 1);
    for (const key of ["anyOf", "allOf", "oneOf"])
      if (Array.isArray(schema[key]))
        result[key] = schema[key]
          .slice(0, 4)
          .map((child: unknown) => visit(child, depth + 1));
    return result;
  }
  const summary = visit(input, 0);
  if (JSON.stringify(summary).length <= 4000) return summary;
  // Preserve all top-level argument names and required/type information if a
  // nested/union-heavy schema exhausts the hint budget.
  const properties = summary.properties as
    Record<string, Record<string, unknown>> | undefined;
  return {
    type: "object",
    required: summary.required,
    properties: Object.fromEntries(
      Object.entries(properties ?? {}).map(([key, schema]) => [
        key,
        { type: schema.type ?? "json" },
      ]),
    ),
    details: "describe_tool",
  };
}
