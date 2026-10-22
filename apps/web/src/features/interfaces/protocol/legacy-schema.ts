import { z } from "zod";
const id = z.string().uuid();
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
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
export const legacyInterfaceSchema = z
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
export type LegacyInterface = z.infer<typeof legacyInterfaceSchema>;
