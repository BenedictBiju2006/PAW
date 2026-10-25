import type { z } from "zod";
import type {
  ToolMetadata,
  ToolResult,
  ToolPolicy,
  SchemaDisclosure,
} from "./server/types";
export interface ExecutionTools {
  registry: {
    resolve(id: string):
      | (Pick<ToolMetadata, "description" | "sideEffects"> & {
          inputSchema: z.ZodObject;
          policy: ToolPolicy;
        })
      | undefined;
    bootstrap(): {
      id: string;
      description: string;
      inputSchema: z.ZodObject;
    }[];
    schemaVersion(id: string): string | undefined;
  };
  disclosures(result: ToolResult): SchemaDisclosure[];
  execute(
    id: string,
    input: unknown,
    disclosure?: { schemaVersion: string; previousResult?: ToolResult },
  ): Promise<ToolResult>;
  schemaRecovery(
    id: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult>;
}
