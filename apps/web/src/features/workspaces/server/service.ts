import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked, ServiceError } from "../../../shared/db/result";
import { id, name } from "../../../shared/validation/identity";
import { emptyInterface } from "../../interfaces/protocol/document";
import { upgradeInterface } from "../../interfaces/protocol/legacy";
export class WorkspaceService {
constructor(private db:SupabaseClient, private userId:string) {}
async workspace(workspaceId: string) {
    id.parse(workspaceId);
    const data = checked(
      await this.db
        .from("workspaces")
        .select("*")
        .eq("id", workspaceId)
        .eq("user_id", this.userId)
        .maybeSingle(),
    );
    if (!data) throw new ServiceError("Workspace not found.", 404);
    try {
      return { ...data, interface: upgradeInterface(data.interface) };
    } catch (error) {
      return {
        ...data,
        interface: emptyInterface(),
        legacySource: data.interface,
        interfaceError: `Saved interface could not be loaded: ${(error as Error).message}. The original definition is preserved.`,
      };
    }
  }
async list(offset = 0, limit = 1000) {
    z.number().int().min(0).max(100000).parse(offset);
    z.number().int().min(1).max(1000).parse(limit);
    return checked(
      await this.db
        .from("workspaces")
        .select("id,name,revision,updated_at")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(offset, offset + limit - 1),
    );
  }
async create(value: unknown) {
    const workspace = checked(
      await this.db
        .from("workspaces")
        .insert({ user_id: this.userId, name: name.parse(value) })
        .select("id")
        .single(),
    );
    if (!workspace) throw new ServiceError("Workspace creation failed.", 500);
    return this.workspace(workspace.id);
  }
async rename(workspaceId: string, value: unknown) {
    await this.workspace(workspaceId);
    checked(
      await this.db
        .from("workspaces")
        .update({ name: name.parse(value) })
        .eq("id", workspaceId)
        .eq("user_id", this.userId)
        .select("id")
        .single(),
    );
    return this.workspace(workspaceId);
  }
async remove(workspaceId: string, confirmation: unknown) {
    await this.workspace(workspaceId);
    if (confirmation !== true)
      throw new ServiceError("Deletion must be confirmed.");
    checked(
      await this.db
        .from("workspaces")
        .delete()
        .eq("id", workspaceId)
        .eq("user_id", this.userId),
    );
  }
}
export type WorkspaceAccess = Pick<WorkspaceService,"workspace">;
