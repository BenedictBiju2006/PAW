import type { ToolResult,ToolMetadata } from "./server/types";
import type { z } from "zod";
export interface ExecutionTools {
registry: { resolve(id:string): (Pick<ToolMetadata,"description"|"sideEffects"> & {inputSchema:z.ZodObject}) | undefined };
execute(id:string,input:unknown):Promise<ToolResult>;
}
