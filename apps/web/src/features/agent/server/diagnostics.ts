import { asSchema, type ToolSet } from "ai";
import "server-only";
/** SDK schema conversion measures the declared tools, not Zod implementation data.
 * Provider-specific wire formatting (notably Google's declaration) may differ. */
export async function toolDefinitionCharacters(tools: ToolSet) {
  const definitions = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      schema: await asSchema(tool.inputSchema).jsonSchema,
    })),
  );
  return JSON.stringify(definitions).length;
}
