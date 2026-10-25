import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import "server-only";
import { z } from "zod";
import { ToolExecutor } from "./executor";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./types";
/** One instance per authenticated host session. No public transport or credentials. */
export function createMcpAdapter<Services>(
  registry: ToolRegistry<Services>,
  context: ToolContext<Services>,
  resources: {
    defaultKind: string;
    templates: { uriTemplate: string; name: string; mimeType: string }[];
  },
) {
  const executor = new ToolExecutor(registry, context);
  const server = new Server(
    { name: "paw", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  // Only bootstrap schemas are loaded initially. describe_tool loads other schemas
  // on demand; tools/call can invoke any registry tool through the same executor.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.bootstrap().map((t) => {
      return {
        name: t.id,
        description: t.description,
        inputSchema: z.toJSONSchema(t.inputSchema) as { type: "object" },
        annotations: { readOnlyHint: true, openWorldHint: false },
      };
    }),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await executor.execute(
      request.params.name,
      request.params.arguments ?? {},
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const offset = request.params?.cursor
      ? z.coerce.number().int().min(0).max(100000).parse(request.params.cursor)
      : 0;
    const result = await executor.execute("list_resources", {
      kind: resources.defaultKind,
      offset,
      limit: 25,
    });
    if (!result.ok) throw new Error(result.error.message);
    const data = result.data as {
      items: {
        uri: string;
        name: string;
        mimeType: string;
        description?: string;
      }[];
      nextOffset: number | null;
    };
    return {
      resources: data.items,
      nextCursor:
        data.nextOffset === null ? undefined : String(data.nextOffset),
    };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: resources.templates,
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const result = await executor.execute("inspect_resource", {
      uri: request.params.uri,
    });
    if (!result.ok) throw new Error(result.error.message);
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(result.data),
        },
      ],
    };
  });
  return server;
}
