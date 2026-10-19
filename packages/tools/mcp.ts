import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolExecutor } from "./executor";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./types";
/** One instance per authenticated host session. No public transport or credentials. */
export function createMcpAdapter(registry: ToolRegistry, context: ToolContext) {
  const executor = new ToolExecutor(registry, context);
  const server = new Server(
    { name: "paw", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  // Only bootstrap schemas are loaded initially. describe_tool loads other schemas
  // on demand; tools/call can invoke any registry tool through the same executor.
  const bootstrap = [
    "search_tools",
    "describe_tool",
    "list_resources",
    "inspect_resource",
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: bootstrap.map((id) => {
      const t = registry.resolve(id)!;
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
      kind: context.workspaceId ? "collections" : "workspaces",
      offset,
      limit: 25,
    });
    if (!result.ok) throw new Error(result.error.message);
    const data = result.data as { items: any[]; nextOffset: number | null };
    return {
      resources: data.items,
      nextCursor:
        data.nextOffset === null ? undefined : String(data.nextOffset),
    };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: "paw://workspaces/{workspaceId}",
        name: "Workspace",
        mimeType: "application/json",
      },
      {
        uriTemplate: "paw://workspaces/{workspaceId}/interface",
        name: "Current interface",
        mimeType: "application/json",
      },
      {
        uriTemplate:
          "paw://workspaces/{workspaceId}/collections/{collectionId}/schema",
        name: "Collection schema",
        mimeType: "application/json",
      },
      {
        uriTemplate:
          "paw://workspaces/{workspaceId}/collections/{collectionId}/records/{recordId}",
        name: "Record",
        mimeType: "application/json",
      },
      {
        uriTemplate:
          "paw://workspaces/{workspaceId}/components/{surfaceId}/{componentId}",
        name: "A2UI component",
        mimeType: "application/json",
      },
      {
        uriTemplate: "paw://workspaces/{workspaceId}/revisions/{revision}",
        name: "Interface revision",
        mimeType: "application/json",
      },
    ],
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
