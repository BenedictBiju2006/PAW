import "server-only";
import { compactSchema } from "../../tooling/server/public";
import type { SchemaDisclosure, ToolResult } from "../../tooling/public";

export type ExecutionReceipt = {
  call: number;
  invocationId: string;
  tool: string;
  status: "succeeded" | "failed";
  mutation: boolean;
  reused?: boolean;
  facts?: unknown;
  deliveryError?: Extract<ToolResult, { ok: false }>["error"];
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Structural projection, never prose summarization. Long values are omitted as
 * whole fields and remain retrievable from the original journal/resource. */
function project(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") return value.length <= 240 ? value : undefined;
  if (depth > 3) return undefined;
  if (Array.isArray(value)) {
    if (value.length > 100) return { omittedItems: value.length };
    return value
      .map((item) => project(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  const data = object(value);
  if (!data) return undefined;
  if (
    Array.isArray(data.allOf) ||
    Array.isArray(data.oneOf) ||
    (data.type === "object" && object(data.properties))
  )
    return compactSchema(data);
  const selected: Record<string, unknown> = Object.create(null);
  const omitted: string[] = [];
  for (const [key, item] of Object.entries(data)) {
    if (key === "components" && object(item)) {
      selected[key] = Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(
          ([name, schema]) => [name, compactSchema(schema)],
        ),
      );
      continue;
    }
    if (
      [
        "inputSchema",
        "outputSchema",
        "definition",
        "interface",
        "messages",
        "description",
        "guidance",
        "instructions",
        "tools",
        "records",
        "components",
        "items",
      ].includes(key)
    )
      continue;
    const projected = project(item, depth + 1);
    if (projected !== undefined) selected[key] = projected;
    else omitted.push(key);
  }
  if (omitted.length) selected.$omittedFields = omitted;
  return selected;
}
function identifiers(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([key, value]) =>
        ((key === "id" || /(?:Id|_id)$/.test(key)) &&
          typeof value === "string" &&
          /^[A-Za-z0-9_-]{1,64}$/.test(value)) ||
        (key === "uri" && typeof value === "string" && value.length <= 500),
    ),
  );
}

export class TurnWorkingState {
  readonly receipts = new Map<number, ExecutionReceipt>();
  private unresolved = new Map<number, ExecutionReceipt>();
  private resources = new Map<string, unknown>();
  private revisions = new Map<
    string,
    { revision: number; observedAt: string }
  >();
  private schemas = new Map<string, SchemaDisclosure>();
  record(input: {
    call: number;
    invocationId: string;
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
    mutation: boolean;
    reused?: boolean;
    recovered: string[];
    schemas: SchemaDisclosure[];
    deliveryError?: Extract<ToolResult, { ok: false }>["error"];
  }) {
    if (input.result.ok) {
      for (const [call, receipt] of this.unresolved)
        if (input.recovered.includes(receipt.tool))
          this.unresolved.delete(call);
      for (const schema of input.schemas) this.schemas.set(schema.id, schema);
    }
    const feedback = input.result.ok ? input.deliveryError : input.result.error;
    const error = feedback
      ? {
          code: feedback.code,
          message: feedback.message,
          guidance: feedback.guidance,
          ...(feedback.nextAction ? { nextAction: feedback.nextAction } : {}),
          ...(feedback.uriPatterns
            ? { uriPatterns: feedback.uriPatterns }
            : {}),
        }
      : undefined;
    const facts = input.result.ok
      ? { ...identifiers(input.args), result: project(input.result.data) }
      : undefined;
    const receipt: ExecutionReceipt = {
      call: input.call,
      invocationId: input.invocationId,
      tool: input.tool,
      status: input.result.ok ? "succeeded" : "failed",
      mutation: input.mutation,
      ...(facts ? { facts } : {}),
      ...(error ? { deliveryError: error } : {}),
      ...(input.reused ? { reused: true } : {}),
    };
    this.receipts.set(input.call, receipt);
    if (!input.result.ok || input.deliveryError)
      this.unresolved.set(input.call, receipt);
    if (input.result.ok && !input.reused) {
      const root = object(input.result.data);
      if (
        typeof root?.revision === "number" &&
        Number.isSafeInteger(root.revision)
      ) {
        const key = String(
          input.args.workspaceId ?? root.uri ?? root.id ?? input.tool,
        );
        if (root.revision >= (this.revisions.get(key)?.revision ?? 0))
          this.revisions.set(key, {
            revision: root.revision,
            observedAt: input.invocationId,
          });
      }
      const scope: Record<string, unknown> = {
        ...identifiers(input.args),
        ...identifiers(root ?? {}),
        ...(typeof root?.revision === "number"
          ? { revision: root.revision }
          : {}),
      };
      const collect = (value: unknown) => {
        const data = object(value);
        if (!data) return;
        const id =
          typeof data.uri === "string"
            ? data.uri
            : typeof data.id === "string"
              ? data.id
              : typeof data.componentId === "string"
                ? data.componentId
                : typeof data.catalogId === "string"
                  ? data.catalogId
                  : typeof data.component === "string"
                    ? `component:${data.component}`
                    : undefined;
        const key =
          id ??
          (typeof data.revision === "number"
            ? String(scope.workspaceId ?? scope.uri ?? input.tool)
            : undefined);
        if (key)
          this.resources.set(
            `${scope.workspaceId ?? ""}/${scope.surfaceId ?? ""}/${key}`,
            {
              ...scope,
              ...object(project(data)),
              observedAt: input.invocationId,
            },
          );
      };
      const data = object(input.result.data);
      if (Array.isArray(input.result.data)) input.result.data.forEach(collect);
      else if (data) {
        collect(data);
        for (const key of ["record", "collection", "workspace"])
          collect(data[key]);
        for (const key of ["records", "components", "items"])
          if (Array.isArray(data[key]))
            (data[key] as unknown[]).forEach(collect);
      }
    }
  }
  isUnresolved(call: number) {
    return this.unresolved.has(call);
  }
  snapshot(version: (id: string) => string | undefined) {
    return {
      resources: [...this.resources.values()],
      observedRevisions: Object.fromEntries(this.revisions),
      schemas: [...this.schemas.values()].map((schema) => ({
        ...schema,
        ...(version(schema.id) !== schema.version ? { stale: true } : {}),
      })),
      completedMutations: [...this.receipts.values()].filter(
        (receipt) => receipt.mutation && receipt.status === "succeeded",
      ),
      unresolved: [...this.unresolved.values()],
    };
  }
}
