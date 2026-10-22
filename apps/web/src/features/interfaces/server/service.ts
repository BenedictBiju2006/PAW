import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked, ServiceError } from "../../../shared/db/result";
import { upgradeInterface } from "../protocol/legacy";
import { inspectInterface, validateBindings } from "../protocol/document";
import { catalogDocument } from "../protocol/catalog";
import type { WorkspaceAccess } from "../../workspaces/server/service";
import type { CollectionService } from "../../collections/server/service";
export class InterfaceService {
constructor(private db:SupabaseClient, private userId:string, private workspaces:WorkspaceAccess, private collectionService:Pick<CollectionService,"collections">) {}
catalog() {
    return catalogDocument();
  }
async inspect(workspaceId: string) {
    const workspace = await this.workspaces.workspace(workspaceId);
    if (workspace.interfaceError)
      throw new ServiceError(workspace.interfaceError);
    return inspectInterface(workspace.interface);
  }
async applyInterfaceMessages(
    workspaceId: string,
    messages: unknown,
    revision: unknown,
  ) {
    const workspace = await this.workspaces.workspace(workspaceId);
    if (workspace.interfaceError)
      throw new ServiceError(workspace.interfaceError);
    if (!Array.isArray(messages))
      throw new ServiceError("Expected an A2UI message array.");
    return this.saveInterface(
      workspaceId,
      { messages: [...workspace.interface.messages, ...messages] },
      revision,
    );
  }
async revision(workspaceId: string, revision: number) {
    await this.workspaces.workspace(workspaceId);
    z.number().int().positive().parse(revision);
    const result = checked(
      await this.db
        .from("interface_revisions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("revision", revision)
        .maybeSingle(),
    );
    if (!result) throw new ServiceError("Revision not found.", 404);
    return result;
  }
async saveInterface(workspaceId: string, input: unknown, revision: unknown) {
    await this.workspaces.workspace(workspaceId);
    const collections = await this.collectionService.collections(workspaceId);
    let definition;
    try {
      definition = upgradeInterface(input);
      validateBindings(definition, collections);
    } catch (error) {
      throw new ServiceError((error as Error).message);
    }
    const expected = z.number().int().positive().parse(revision);
    const result = checked(
      await this.db
        .from("workspaces")
        .update({ interface: definition })
        .eq("id", workspaceId)
        .eq("user_id", this.userId)
        .eq("revision", expected)
        .select("*")
        .maybeSingle(),
    );
    if (!result)
      throw new ServiceError(
        "Interface changed in another session. Reload before saving.",
        409,
      );
    return result;
  }
async revisions(workspaceId: string, offset = 0, limit = 20) {
    z.number().int().min(0).max(100000).parse(offset);
    z.number().int().min(1).max(100).parse(limit);
    await this.workspaces.workspace(workspaceId);
    return checked(
      await this.db
        .from("interface_revisions")
        .select("revision,definition,created_at")
        .eq("workspace_id", workspaceId)
        .order("revision", { ascending: false })
        .range(offset, offset + limit - 1),
    );
  }
}
