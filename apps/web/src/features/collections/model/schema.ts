import { z } from "zod";
import { name } from "../../../shared/validation/identity";
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

export type CollectionAggregation = {
  count: number;
  distinctValues: number;
  buckets: { value: unknown; count: number }[];
};
