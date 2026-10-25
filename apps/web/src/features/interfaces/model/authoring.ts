import { z } from "zod";
import { componentApis } from "../protocol/catalog";

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
export const componentName = z.enum(
  componentApis.map((api) => api.name) as [string, ...string[]],
);
const properties = z
  .record(z.string(), z.json())
  .describe(
    "Official component properties. Search UI components or inspect_component for schemas/examples. Do not include id or component. Child references may use keys from this batch.",
  );
export const authoredComponent = z
  .object({
    key: identifier
      .optional()
      .describe(
        "Optional local key for child references in this batch; PAW generates the saved component ID.",
      ),
    component: componentName,
    properties,
  })
  .strict()
  .superRefine((value, ctx) => {
    const api = componentApis.find((api) => api.name === value.component)!;
    const result = api.schema.safeParse(value.properties);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({
          code: "custom",
          path: ["properties", ...issue.path],
          message: issue.message,
        });
  });
export const placement = z
  .object({
    parentId: identifier
      .default("root")
      .describe("Existing Column or Row with a fixed children array."),
    index: z
      .number()
      .int()
      .min(0)
      .max(200)
      .optional()
      .describe("Zero-based insertion position; omitted means append."),
  })
  .strict();
export const addUiInput = z
  .object({
    workspaceId: z.uuid(),
    revision: z.number().int().positive(),
    surfaceId: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
      .optional()
      .describe("May be omitted only when the interface has one surface."),
    components: z.array(authoredComponent).min(1).max(100),
    layout: placement
      .extend({
        direction: z
          .enum(["Column", "Row"])
          .optional()
          .describe(
            "Optional layout direction for the target parent. Existing children are preserved.",
          ),
      })
      .optional(),
  })
  .strict();
export const updateUiInput = z
  .object({
    workspaceId: z.uuid(),
    revision: z.number().int().positive(),
    surfaceId: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
      .optional(),
    componentId: identifier,
    properties: properties
      .default({})
      .describe(
        "Property patch merged into the existing component; type and ID stay unchanged.",
      ),
    removeProperties: z
      .array(z.string().min(1).max(100))
      .max(30)
      .default([])
      .describe(
        "Optional properties to remove, such as title. Required properties cannot be removed.",
      ),
    placement: placement
      .optional()
      .describe(
        "Move or reorder the component within an existing Column/Row without rebuilding the interface.",
      ),
  })
  .strict();
export type AddUiInput = z.infer<typeof addUiInput>;
export type UpdateUiInput = z.infer<typeof updateUiInput>;
