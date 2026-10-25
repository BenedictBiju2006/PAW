import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import { z } from "zod";
import { checked, ServiceError } from "../../../shared/db/result";
import type { CollectionService } from "../../collections/server/public";
import type { WorkspaceAccess } from "../../workspaces/server/public";
import { addUiInput, updateUiInput } from "../model/authoring";
import { addUiComponents, updateUiComponent } from "../protocol/authoring";
import { catalogDocument, CatalogSchemaError } from "../protocol/catalog";
import { inspectInterface, validateBindings } from "../protocol/document";
import { upgradeInterface } from "../protocol/legacy";
export class InterfaceService {
  constructor(
    private db: SupabaseClient,
    private userId: string,
    private workspaces: WorkspaceAccess,
    private collectionService: Pick<CollectionService, "collections">,
  ) {}
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
      throw new ServiceError(
        (error as Error).message,
        error instanceof CatalogSchemaError ? 500 : 400,
        error,
      );
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
  async addUiComponents(input: unknown) {
    const args = addUiInput.parse(input);
    const workspace = await this.workspaces.workspace(args.workspaceId);
    if (workspace.interfaceError)
      throw new ServiceError(workspace.interfaceError);
    if (workspace.revision !== args.revision)
      throw new ServiceError(
        "Interface changed in another session. Inspect its current revision before retrying.",
        409,
      );
    let authored;
    try {
      authored = addUiComponents(workspace.interface, args);
    } catch (error) {
      throw new ServiceError(
        (error as Error).message,
        error instanceof CatalogSchemaError ? 500 : 400,
        error,
      );
    }
    const saved = await this.saveInterface(
      args.workspaceId,
      authored.definition,
      args.revision,
    );
    return {
      surfaceId: authored.surfaceId,
      components: authored.components,
      revision: saved.revision,
    };
  }
  async updateUiComponent(input: unknown) {
    const args = updateUiInput.parse(input);
    const workspace = await this.workspaces.workspace(args.workspaceId);
    if (workspace.interfaceError)
      throw new ServiceError(workspace.interfaceError);
    if (workspace.revision !== args.revision)
      throw new ServiceError(
        "Interface changed in another session. Inspect its current revision before retrying.",
        409,
      );
    let authored;
    try {
      authored = updateUiComponent(workspace.interface, args);
    } catch (error) {
      throw new ServiceError(
        (error as Error).message,
        error instanceof CatalogSchemaError ? 500 : 400,
        error,
      );
    }
    const saved = await this.saveInterface(
      args.workspaceId,
      authored.definition,
      args.revision,
    );
    return {
      surfaceId: authored.surfaceId,
      componentId: authored.componentId,
      revision: saved.revision,
    };
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
