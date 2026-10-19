import { z } from "zod";

export const id = z.uuid();
export const name = z.string().trim().min(1).max(100);
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
export const fieldSchema = z
  .object({
    key,
    label: name,
    type: z.enum(["string", "number", "boolean", "date", "enum"]),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (
      field.type === "enum" &&
      (!field.options?.length ||
        new Set(field.options).size !== field.options.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Enum fields need unique options.",
      });
  });
export const fieldsSchema = z
  .array(fieldSchema)
  .min(1)
  .max(30)
  .refine(
    (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
    "Field keys must be unique.",
  );
export type Field = z.infer<typeof fieldSchema>;
export type RecordData = Record<string, string | number | boolean | null>;
export function validateData(fields: Field[], value: unknown): RecordData {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    let validator: z.ZodType;
    switch (field.type) {
      case "number":
        validator = z.number().finite();
        break;
      case "boolean":
        validator = z.boolean();
        break;
      case "date":
        validator = z.iso.date();
        break;
      case "enum":
        validator = z.enum(field.options as [string, ...string[]]);
        break;
      default:
        validator = z.string().max(10000);
        if (field.required) validator = (validator as z.ZodString).min(1);
    }
    shape[field.key] = field.required
      ? validator
      : validator.nullable().optional();
  }
  return z.object(shape).strict().parse(value) as RecordData;
}
export type Node = {
  id: string;
  type:
    | "container"
    | "heading"
    | "text"
    | "form"
    | "table"
    | "list"
    | "chart"
    | "tabs"
    | "button";
  text?: string;
  collectionId?: string;
  field?: string;
  children?: Node[];
};
const nodeSchema: z.ZodType<Node> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
      type: z.enum([
        "container",
        "heading",
        "text",
        "form",
        "table",
        "list",
        "chart",
        "tabs",
        "button",
      ]),
      text: z.string().max(1000).optional(),
      collectionId: id.optional(),
      field: key.optional(),
      children: z.array(nodeSchema).max(50).optional(),
    })
    .strict(),
);
export const interfaceSchema = z
  .object({ version: z.literal(1), nodes: z.array(nodeSchema).max(50) })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    let count = 0;
    function visit(nodes: Node[], depth: number) {
      if (depth > 8) {
        ctx.addIssue({
          code: "custom",
          message: "Interface exceeds eight nested levels.",
        });
        return;
      }
      for (const node of nodes) {
        if (++count > 200 || ids.has(node.id)) {
          ctx.addIssue({
            code: "custom",
            message: "Use at most 200 components with unique IDs.",
          });
          return;
        }
        ids.add(node.id);
        if (
          ["form", "table", "list", "chart"].includes(node.type) &&
          !node.collectionId
        )
          ctx.addIssue({
            code: "custom",
            message: `${node.type} requires a collectionId.`,
          });
        if (node.type === "chart" && !node.field)
          ctx.addIssue({ code: "custom", message: "Charts require a field." });
        if (node.children?.length && !["container", "tabs"].includes(node.type))
          ctx.addIssue({
            code: "custom",
            message: "Only containers and tabs accept children.",
          });
        visit(node.children ?? [], depth + 1);
      }
    }
    visit(value.nodes, 1);
  });
export type Interface = z.infer<typeof interfaceSchema>;
export type Collection = {
  id: string;
  workspace_id: string;
  name: string;
  fields: Field[];
};
export type DataRecord = {
  id: string;
  collection_id: string;
  data: RecordData;
  updated_at: string;
};
export type Workspace = {
  id: string;
  name: string;
  interface: Interface;
  revision: number;
  updated_at: string;
};
export function validateBindings(
  definition: Interface,
  collections: Collection[],
) {
  function visit(nodes: Node[]) {
    for (const node of nodes) {
      if (node.collectionId) {
        const collection = collections.find((c) => c.id === node.collectionId);
        if (!collection)
          throw new Error(
            "Interface references a collection outside this workspace.",
          );
        if (node.field && !collection.fields.some((f) => f.key === node.field))
          throw new Error("Interface references an unknown field.");
      }
      visit(node.children ?? []);
    }
  }
  visit(definition.nodes);
}
