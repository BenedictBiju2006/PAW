import { z } from "zod";
import { spec } from "@a2ui/web_core/catalog";
import { Catalog, CommonSchemas } from "@a2ui/web_core/v0_9";
import {
  TextApi,
  RowApi,
  ColumnApi,
  CardApi,
  ButtonApi,
  TextFieldApi,
  TabsApi,
  ListApi,
  DividerApi,
  CheckBoxApi,
} from "@a2ui/web_core/v0_9/basic_catalog";

export const PROTOCOL = "v0.9.1" as const;
export const CATALOG_ID = "https://paw.local/catalogs/workspace-v1.json";
const collectionId = z
  .string()
  .uuid()
  .describe(
    "Persistent collection in the current workspace. Cannot be a transient binding.",
  );
export const CollectionFormApi = {
  name: "CollectionForm",
  schema: spec(
    z
      .object({ collectionId, title: CommonSchemas.DynamicString.optional() })
      .strict()
      .describe(
        "Typed collection form. Dispatches paw.createRecord with validated field data; persistent records are never embedded in the A2UI model.",
      ),
    { mixins: ["ComponentCommon"] },
  ),
};
export const DataTableApi = {
  name: "DataTable",
  schema: spec(
    z
      .object({
        collectionId,
        title: CommonSchemas.DynamicString.optional(),
        presentation: z.enum(["table", "list"]).optional(),
      })
      .strict()
      .describe(
        "Authorized persistent records with edit/delete actions, exact filtering, typed sorting, and pagination. Mutations refresh other collection views.",
      ),
    { mixins: ["ComponentCommon"] },
  ),
};
export const CollectionChartApi = {
  name: "CollectionChart",
  schema: spec(
    z
      .object({
        collectionId,
        field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
        title: CommonSchemas.DynamicString.optional(),
      })
      .strict()
      .describe(
        "Full-collection aggregation for the specified field, displaying at most 100 distinct value counts.",
      ),
    { mixins: ["ComponentCommon"] },
  ),
};
export const componentApis = [
  TextApi,
  RowApi,
  ColumnApi,
  CardApi,
  ButtonApi,
  TextFieldApi,
  CheckBoxApi,
  TabsApi,
  ListApi,
  DividerApi,
  CollectionFormApi,
  DataTableApi,
  CollectionChartApi,
];
export const schemaCatalog = new Catalog(
  CATALOG_ID,
  PROTOCOL,
  componentApis,
  [],
  {
    extensionFields: {
      "x-paw-actions": {
        "paw.refresh": {
          description: "Refresh persistent collection views without inference.",
          contextSchema: { type: "object", additionalProperties: false },
        },
        "paw.createRecord": {
          description:
            "Create one record in an authorized workspace collection. Resolve dynamic context bindings before dispatch; the server validates the collection schema. Disabled in preview.",
          contextSchema: {
            type: "object",
            properties: {
              collectionId: { type: "string", format: "uuid" },
              data: { type: "object" },
            },
            required: ["collectionId", "data"],
            additionalProperties: false,
          },
        },
      },
    },
    commonTypesUri: "https://a2ui.org/specification/v0_9/common_types.json",
    instructions:
      "PAW workspace catalog. Use root as the surface root. Persistent records live in authorized collections, not updateDataModel. Supported events: paw.refresh, paw.createRecord (collectionId and data context). No network navigation or arbitrary functions.",
  },
);
export function catalogDocument() {
  return schemaCatalog.toJson();
}
