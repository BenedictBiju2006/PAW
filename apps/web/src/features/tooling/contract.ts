import type { z } from "zod";
import type { ToolMetadata, ToolResult } from "./server/types";
export interface ExecutionTools {
  registry: {
    resolve(id: string):
      | (Pick<ToolMetadata, "description" | "sideEffects"> & {
          inputSchema: z.ZodObject;
        })
      | undefined;
  };
  execute(id: string, input: unknown): Promise<ToolResult>;
}
