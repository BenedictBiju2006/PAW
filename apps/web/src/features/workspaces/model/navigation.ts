import { isEmptyInterface } from "../../interfaces/public";
import type { Workspace } from "./types";
export type WorkspaceDestination =
  | { kind: "new-chat" }
  | { kind: "conversation"; conversationId: string }
  | { kind: "interface" };
export function defaultDestination(workspace: Workspace): WorkspaceDestination {
  return workspace.interfaceError || !isEmptyInterface(workspace.interface)
    ? { kind: "interface" }
    : { kind: "new-chat" };
}
export function destinationFromUrl(
  params: URLSearchParams,
): WorkspaceDestination | undefined {
  const conversationId = params.get("conversation");
  if (conversationId) return { kind: "conversation", conversationId };
  if (params.get("view") === "interface") return { kind: "interface" };
  if (params.get("view") === "chat") return { kind: "new-chat" };
}
export function workspaceUrl(
  workspaceId: string | null,
  destination: WorkspaceDestination,
): string {
  if (!workspaceId) return "/";
  const params = new URLSearchParams({ workspace: workspaceId });
  if (destination.kind === "conversation")
    params.set("conversation", destination.conversationId);
  else
    params.set("view", destination.kind === "interface" ? "interface" : "chat");
  return `/?${params}`;
}
