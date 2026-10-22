import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkspaceService } from "../features/workspaces/server/service";
import { CollectionService } from "../features/collections/server/service";
import { InterfaceService } from "../features/interfaces/server/service";
/** Request-scoped composition; each feature implements its own business rules. */
export function createWorkspaceServices(db:SupabaseClient, actor:string) {
const workspaces=new WorkspaceService(db,actor);
const collections=new CollectionService(db,workspaces);
const interfaces=new InterfaceService(db,actor,workspaces,collections);
return {
workspace: workspaces.workspace.bind(workspaces),
list: workspaces.list.bind(workspaces),
create: workspaces.create.bind(workspaces),
rename: workspaces.rename.bind(workspaces),
remove: workspaces.remove.bind(workspaces),
collections: collections.collections.bind(collections),
createCollection: collections.createCollection.bind(collections),
collection: collections.collection.bind(collections),
records: collections.records.bind(collections),
record: collections.record.bind(collections),
aggregate: collections.aggregate.bind(collections),
writeRecord: collections.writeRecord.bind(collections),
deleteRecord: collections.deleteRecord.bind(collections),
catalog: interfaces.catalog.bind(interfaces),
inspect: interfaces.inspect.bind(interfaces),
applyInterfaceMessages: interfaces.applyInterfaceMessages.bind(interfaces),
revision: interfaces.revision.bind(interfaces),
saveInterface: interfaces.saveInterface.bind(interfaces),
revisions: interfaces.revisions.bind(interfaces),
};
}
export type WorkspaceServices=ReturnType<typeof createWorkspaceServices>;
