import "server-only";
import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
import type { ToolRegistry } from "../../tooling/server/public";
import { registrar } from "../../tooling/server/public";
import type { WorkspaceAccess } from "../../workspaces/server/public";
import { addUiInput, updateUiInput } from "../model/authoring";
import {
  searchUiComponents,
  componentAuthoringExample,
} from "../protocol/discovery";
import { catalogComponents } from "../protocol/catalog";
import type { InterfaceService } from "./service";
const workspaceId = z.uuid(),
  collectionId = z.uuid(),
  recordId = z.uuid();
const page = {
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};
const revision = z.number().int().positive();
const data = z.record(z.string(), z.json());
export function registerInterfacesTools<
  Services extends Pick<InterfaceService, keyof InterfaceService> &
    WorkspaceAccess,
>(registry: ToolRegistry<Services>) {
  const add = registrar(registry);
  add(
    "search_ui_components",
    "Find UI component types by use case (heading, editable table, form, chart, layout). This is component discovery; inspect_resource reads existing workspace resources.",
    "Before authoring, search supported components. Set component to one exact type for its catalog schema and a minimal valid batch example; inspect_component also supplies examples.",
    [
      "ui",
      "components",
      "discover",
      "heading",
      "table",
      "form",
      "chart",
      "layout",
    ],
    z
      .object({
        query: z.string().max(500).default(""),
        component: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(30).default(10),
      })
      .strict(),
    "Compact component summaries with required properties, use cases and example properties; one component detail includes schema and a valid batch example.",
    async (a) => {
      if (a.component) {
        if (!Object.hasOwn(catalogComponents(), a.component))
          throw new ServiceError(
            "Unknown component type. Use search_ui_components.",
            404,
          );
        return componentAuthoringExample(a.component);
      }
      return searchUiComponents(a.query, a.limit);
    },
  );
  add(
    "add_ui_components",
    "Add several UI components in ONE batch. PAW generates IDs, resolves local child keys, attaches the layout and saves valid official A2UI. Prefer this over manually constructing A2UI messages.",
    "Inspect interface for revision, discover component properties, then supply components [{key,component,properties}]. Column/Row children and Card child can reference batch keys. Unreferenced components attach in input order to root (or layout.parentId). Tables/forms/charts use collectionId; no columns/fields arrays. Existing components and records are preserved.",
    [
      "ui",
      "interface",
      "build",
      "add",
      "batch",
      "heading",
      "table",
      "form",
      "chart",
      "movies",
    ],
    addUiInput,
    "{surfaceId, components:[{key?,id,component}], revision}; executor ok/error confirms atomic success/failure. No complete interface or collection records returned.",
    async (a, c) => c.service.addUiComponents(a),
    "write",
  );
  add(
    "update_ui_component",
    "Patch one existing UI component and optionally move/reorder it in a Column or Row. Preserve its ID, type, other components and collection data.",
    "Use IDs/revision from inspect_interface or add_ui_components. Supply a partial properties object and optional placement {parentId,index}; removeProperties resets optional properties. Use raw A2UI tools for complex template/shared layouts.",
    ["ui", "interface", "update", "edit", "move", "layout", "reorder"],
    updateUiInput,
    "{surfaceId,componentId,revision}; executor ok/error confirms atomic success/failure. No full interface returned.",
    async (a, c) => c.service.updateUiComponent(a),
    "write",
  );
  add(
    "get_catalog",
    "Retrieve the official PAW A2UI component catalog.",
    "Discover supported component schemas, properties and actions before building an interface.",
    ["a2ui", "interface", "catalog", "components"],
    z.object({}).strict(),
    "Official A2UI catalog JSON with components and supported PAW actions.",
    async (a, c) => c.service.catalog(),
  );
  add(
    "inspect_component",
    "Inspect a UI component type: official property schema plus a minimal valid authoring example. Use search_ui_components to find types; inspect_resource reads existing workspace resources.",
    "Learn how to construct a catalog component such as CollectionForm or DataTable.",
    ["a2ui", "components", "properties", "schema"],
    z.object({ component: z.string().max(100) }).strict(),
    "Component JSON schema.",
    async (a, c) => {
      const components = catalogComponents();
      if (!Object.hasOwn(components, a.component))
        throw new ServiceError("Unknown component type.", 404);
      const { schema: _schema, ...authoring } = componentAuthoringExample(
        a.component,
      );
      return {
        ...(components[a.component] as Record<string, unknown>),
        "x-paw-authoring": authoring,
      };
    },
  );
  add(
    "inspect_interface",
    "Retrieve the current A2UI interface, revision and reconstructed components.",
    "Inspect authoritative UI state before appending messages or saving a definition.",
    ["a2ui", "interface", "inspect", "revision"],
    z.object({ workspaceId }).strict(),
    "{definition, revision, surfaces}; each surface includes current component properties.",
    async (a, c) => {
      const w = await c.service.workspace(a.workspaceId);
      return {
        definition: w.interface,
        revision: w.revision,
        surfaces: await c.service.inspect(a.workspaceId),
      };
    },
  );
  add(
    "apply_interface_messages",
    "Apply official A2UI messages incrementally with an expected revision.",
    "Mutate current components or data bindings through the existing validation pipeline.",
    ["a2ui", "interface", "messages", "update"],
    z
      .object({
        workspaceId,
        messages: z.array(z.json()).min(1).max(200),
        revision,
      })
      .strict(),
    "Saved workspace with new interface revision; invalid A2UI or stale revisions fail atomically.",
    async (a, c) =>
      c.service.applyInterfaceMessages(a.workspaceId, a.messages, a.revision),
    "write",
  );
  add(
    "save_interface",
    "Save a complete validated A2UI definition with an expected revision.",
    "Construct or restore the workspace interface without changing collection data.",
    ["a2ui", "interface", "save", "build"],
    z.object({ workspaceId, definition: z.json(), revision }).strict(),
    "Saved workspace with incremented revision.",
    async (a, c) =>
      c.service.saveInterface(a.workspaceId, a.definition, a.revision),
    "write",
  );
  add(
    "list_revisions",
    "List original saved interface revisions.",
    "Inspect revision history and recover previous definitions.",
    ["a2ui", "interface", "history", "revision"],
    z.object({ workspaceId, ...page }).strict(),
    "Bounded revisions with revision number, definition and created_at.",
    async (a, c) => c.service.revisions(a.workspaceId, a.offset, a.limit),
  );
}
