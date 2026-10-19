import { z } from "zod";
import type { ToolDefinition, ToolMetadata, ToolContext } from "./types";
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  register<S extends z.ZodObject>(
    metadata: ToolMetadata,
    inputSchema: S,
    handler: (args: z.infer<S>, context: ToolContext) => Promise<unknown>,
  ) {
    if (this.tools.has(metadata.id))
      throw new Error(`Duplicate tool: ${metadata.id}`);
    this.tools.set(metadata.id, { ...metadata, inputSchema, handler });
    return this;
  }
  resolve(id: string) {
    return this.tools.get(id);
  }
  summaries() {
    return [...this.tools.values()].map(
      ({ inputSchema, handler, ...metadata }) => metadata,
    );
  }
  describe(id: string) {
    const tool = this.resolve(id);
    if (!tool)
      throw new Error(
        `Unknown tool: ${id}. Use search_tools to discover capabilities.`,
      );
    const { handler, inputSchema, ...metadata } = tool;
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
  search(query: string, limit = 10) {
    const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return this.summaries()
      .map((tool) => ({
        tool,
        score: words.reduce(
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
