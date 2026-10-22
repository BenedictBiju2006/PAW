import { z } from "zod";
export const contentBlock = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("text"), text: z.string().min(1).max(50000) })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      invocationId: z.string().min(1).max(100),
      toolId: z.string().min(1).max(100),
      arguments: z.record(z.string(), z.json()),
      status: z.enum([
        "pending",
        "running",
        "completed",
        "failed",
        "awaiting_confirmation",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      invocationId: z.string().min(1).max(100),
      toolId: z.string().min(1).max(100),
      result: z.json(),
      isError: z.boolean(),
    })
    .strict(),
]);
export const messageInput = z
  .object({
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.array(contentBlock).min(1).max(100),
    metadata: z
      .object({
        provider: z.string().max(100).optional(),
        model: z.string().max(200).optional(),
        invocationId: z.string().max(100).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Conversation = {
  id: string;
  workspace_id: string;
  title: string;
  title_origin?: "default" | "generated" | "fallback" | "manual";
  title_attempted?: boolean;
  title_revision?: number;
  created_at: string;
  updated_at: string;
};
export type Message = z.infer<typeof messageInput> & {
  id: string;
  conversation_id: string;
  workspace_id: string;
  sequence: number;
  trusted?: boolean;
  turn_id?: string | null;
  created_at: string;
};
