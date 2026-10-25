import { createHash } from "node:crypto";
import "server-only";
import type { ExecutionTools } from "../contract";
import type { SchemaDisclosure, ToolResult } from "./types";

/** Only receipts issued by the executor can authorize schemas. Read reuse
 * compares fresh authorized results; it never bypasses a handler or permission. */
export class TurnKnowledge {
  private schemas = new Map<
    string,
    { version: string; invocationId: string }
  >();
  private reads = new Map<string, { hash: string; invocationId: string }>();
  private initialSchemas = new Map<string, string>();
  constructor(private executor: ExecutionTools) {
    for (const tool of executor.registry.bootstrap()) {
      const version = executor.registry.schemaVersion(tool.id);
      if (version) this.initialSchemas.set(tool.id, version);
    }
  }
  version(id: string) {
    const current = this.executor.registry.schemaVersion(id);
    if (current && this.initialSchemas.get(id) === current) return current;
    const known = this.schemas.get(id);
    return current && known?.version === current ? current : undefined;
  }
  prepare(
    id: string,
    args: Record<string, unknown>,
    signature: string,
    result: ToolResult,
    receipts: SchemaDisclosure[],
  ): ToolResult {
    const definition = this.executor.registry.resolve(id);
    if (
      (result.ok && definition?.sideEffects !== "none") ||
      (!result.ok && result.error.code === "conflict")
    )
      this.reads.clear();
    if (!result.ok) return result;
    if (receipts.length && definition?.policy.reuse === "schema") {
      const data = asObject(result.data);
      const replace = (entry: unknown) => {
        const value = asObject(entry);
        const receipt = receipts.find((receipt) => receipt.id === value?.id);
        const previous = receipt && this.schemas.get(receipt.id);
        return receipt && previous?.version === receipt.version
          ? {
              id: receipt.id,
              schemaVersion: receipt.version,
              unchanged: true,
              disclosedAt: previous.invocationId,
              guidance:
                "Schema already received in this turn. Invoke using its validated arguments; no repeated description is needed.",
            }
          : entry;
      };
      return {
        ok: true,
        data: Array.isArray(data?.tools)
          ? { ...data, tools: data.tools.map(replace) }
          : replace(result.data),
      };
    }
    if (definition?.policy.reuse === "resource") {
      const previous = this.reads.get(signature);
      if (previous?.hash === digest(result.data))
        return {
          ok: true,
          data: {
            unchanged: true,
            observedAt: previous.invocationId,
            references: verifiedReferences(args, result.data),
            guidance:
              "This authorized read is unchanged. Reuse these identifiers/revision and the earlier result; inspect again after a state change or conflict.",
          },
        };
    }
    return result;
  }
  commit(
    id: string,
    signature: string,
    raw: ToolResult,
    delivered: ToolResult,
    receipts: SchemaDisclosure[],
    invocationId: string,
  ) {
    if (!raw.ok || !delivered.ok) return [];
    const data = asObject(delivered.data);
    const entries = Array.isArray(data?.tools) ? data.tools : [data];
    const accepted: string[] = [];
    for (const receipt of receipts) {
      if (this.executor.registry.schemaVersion(receipt.id) !== receipt.version)
        continue;
      const entry = entries
        .map(asObject)
        .find((entry) => entry?.id === receipt.id);
      if (!entry) continue;
      const previous = this.schemas.get(receipt.id);
      const repeated =
        entry.unchanged === true &&
        entry.disclosedAt === previous?.invocationId &&
        previous?.version === receipt.version;
      if (
        entry.schemaVersion === receipt.version &&
        (repeated ||
          JSON.stringify(entry.inputSchema) ===
            JSON.stringify(receipt.inputSchema))
      ) {
        if (!repeated)
          this.schemas.set(receipt.id, {
            version: receipt.version,
            invocationId,
          });
        accepted.push(receipt.id);
      }
    }
    if (this.executor.registry.resolve(id)?.policy.reuse === "resource") {
      if (JSON.stringify(raw.data) === JSON.stringify(delivered.data))
        this.reads.set(signature, { hash: digest(raw.data), invocationId });
      // An unchanged marker points to an already-delivered full result.
    }
    return accepted;
  }
}
function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function verifiedReferences(args: Record<string, unknown>, data: unknown) {
  const value = asObject(data) ?? {};
  const references: Record<string, unknown> = {};
  for (const source of [args, value])
    for (const [key, item] of Object.entries(source)) {
      if (
        (key === "id" || /(?:Id|_id)$/.test(key)) &&
        typeof item === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(item)
      )
        references[key] = item;
      if (
        key === "revision" &&
        typeof item === "number" &&
        Number.isSafeInteger(item) &&
        item > 0
      )
        references.revision = item;
      if (key === "uri" && typeof item === "string" && item.length <= 500)
        references.uri = item;
      if (Object.keys(references).length >= 12) return references;
    }
  return references;
}
