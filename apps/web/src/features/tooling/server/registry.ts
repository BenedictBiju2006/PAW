import "server-only";
import { createHash } from "node:crypto";
import { compactSchema } from "./recovery";
import { schemaExample } from "./schema-example";
import { z } from "zod";
import type {
  ToolContext,
  ToolDefinition,
  ToolMetadata,
  ToolResult,
  ToolPolicy,
  SchemaDisclosure,
} from "./types";
export class ToolRegistry<Services = unknown> {
  constructor(
    readonly authorize?: (
      args: Record<string, unknown>,
      id: string,
      context: ToolContext<Services>,
    ) => Promise<Extract<ToolResult, { ok: false }> | void>,
  ) {}
  private schemaIds = new WeakMap<object, number>();
  private nextSchemaId = 1;
  private tools = new Map<string, ToolDefinition<Services>>();
  register<S extends z.ZodObject>(
    metadata: ToolMetadata,
    inputSchema: S,
    handler: (
      args: z.infer<S>,
      context: ToolContext<Services>,
    ) => Promise<unknown>,
    policy: ToolPolicy = {},
  ) {
    if (this.tools.has(metadata.id))
      throw new Error(`Duplicate tool: ${metadata.id}`);
    this.tools.set(metadata.id, {
      ...metadata,
      inputSchema,
      policy,
      handler: (args, context) => handler(inputSchema.parse(args), context),
    });
    return this;
  }
  resolve(id: string) {
    return this.tools.get(id);
  }
  summaries() {
    return [...this.tools.values()].map(
      ({ inputSchema, handler, policy, ...metadata }) => metadata,
    );
  }
  describe(id: string) {
    const tool = this.resolve(id);
    if (!tool)
      throw new Error(
        `Unknown tool: ${id}. Use search_tools to discover capabilities.`,
      );
    const { handler, inputSchema, policy, ...metadata } = tool;
    return {
      ...metadata,
      inputSchema: z.toJSONSchema(inputSchema),
      outputSchema: {
        type: "object",
        description: tool.result,
        properties: {
          ok: { type: "boolean" },
          data: { description: tool.result },
          error: { type: "object" },
        },
        required: ["ok"],
      },
    };
  }
  bootstrap() {
    return [...this.tools.values()].filter((tool) => tool.policy.bootstrap);
  }
  schemaVersion(id: string) {
    const tool = this.resolve(id);
    if (!tool) return undefined;
    if (!this.schemaIds.has(tool.inputSchema))
      this.schemaIds.set(tool.inputSchema, this.nextSchemaId++);
    return createHash("sha256")
      .update(
        JSON.stringify({
          id,
          identity: this.schemaIds.get(tool.inputSchema),
          schema: z.toJSONSchema(tool.inputSchema, { io: "input" }),
          permissions: tool.requiredPermissions,
          sideEffects: tool.sideEffects,
        }),
      )
      .digest("hex")
      .slice(0, 24);
  }
  compactDescription(id: string) {
    const tool = this.resolve(id)!;
    const schema = z.toJSONSchema(tool.inputSchema, { io: "input" });
    const example = tool.policy.examples?.[0] ?? schemaExample(schema);
    return {
      id,
      description: tool.description.slice(0, 240),
      schemaVersion: this.schemaVersion(id),
      inputSchema: compactSchema(schema),
      ...(tool.inputSchema.safeParse(example).success &&
      JSON.stringify(example).length <= 1200
        ? {
            example: structuredClone(example),
            exampleNote:
              "Syntax example only: use current authorized IDs, revisions and resource-specific data fields.",
          }
        : {
            exampleNote:
              "Inspect the detailed schema for context-dependent properties.",
          }),
    };
  }
  confirmDisclosures(data: unknown): SchemaDisclosure[] {
    if (!data || typeof data !== "object") return [];
    const value = data as Record<string, unknown>;
    const entries = Array.isArray(value.tools) ? value.tools : [value];
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string")
        return [];
      const version = this.schemaVersion(entry.id);
      if (!version || entry.schemaVersion !== version) return [];
      const expected = Array.isArray(value.tools)
        ? this.compactDescription(entry.id).inputSchema
        : this.describe(entry.id).inputSchema;
      return JSON.stringify(entry.inputSchema) === JSON.stringify(expected)
        ? [{ id: entry.id, version, inputSchema: entry.inputSchema }]
        : [];
    });
  }
  search(query: string, limit = 10) {
    const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return this.summaries()
      .map((tool) => ({
        tool,
        score:
          (query.trim().toLowerCase().replace(/_/g, " ") ===
          tool.id.toLowerCase().replace(/_/g, " ")
            ? words.length + 1
            : 0) +
          words.reduce(
            (n, word) =>
              n +
              ([
                tool.id,
                tool.name,
                tool.description,
                tool.purpose,
                ...tool.keywords,
              ]
                .join(" ")
                .toLowerCase()
                .includes(word)
                ? 1
                : 0),
            0,
          ),
      }))
      .filter((x) => x.score > 0 || !words.length)
      .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id))
      .slice(0, limit)
      .map(({ tool }) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        summary: tool.purpose,
      }));
  }
}
