import { legacyInterfaceSchema, type Node } from "./legacy-schema";
import { CATALOG_ID, PROTOCOL } from "./catalog";
import { parseInterface, type Component, type Interface } from "./document";
/** Deterministic compatibility boundary. Original revision JSON is never rewritten. */
export function upgradeInterface(input: unknown): Interface {
  if (input && typeof input === "object" && "messages" in input)
    return parseInterface(input);
  const legacy = legacyInterfaceSchema.parse(input);
  const components: Component[] = [];
  const used = new Set<string>(
    legacy.nodes.flatMap(function ids(node): string[] {
      return [node.id, ...(node.children ?? []).flatMap(ids)];
    }),
  );
  const unique = (base: string) => {
    let result = base.slice(0, 48);
    let suffix = 0;
    while (used.has(result)) result = `${base.slice(0, 48)}_${++suffix}`;
    used.add(result);
    return result;
  };
  // v0.9.1 component IDs are identifiers. Rename legacy hyphens and root
  // deterministically while preserving every reference and displayed value.
  const names = new Map<string, string>();
  for (const original of [...used])
    names.set(
      original,
      original === "root" || original.includes("-")
        ? unique(`legacy_${original.replace(/-/g, "_")}`)
        : original,
    );
  function convert(node: Node): string {
    const id = names.get(node.id)!;
    const children = (node.children ?? []).map(convert);
    const title = node.text === undefined ? {} : { title: node.text };
    switch (node.type) {
      case "heading":
        components.push({
          id,
          component: "Text",
          text: node.text ?? "",
          variant: "h2",
        });
        break;
      case "text":
        components.push({ id, component: "Text", text: node.text ?? "" });
        break;
      case "container":
        components.push({ id, component: "Column", children });
        break;
      case "tabs":
        if (!children.length)
          components.push({ id, component: "Column", children: [] });
        else
          components.push({
            id,
            component: "Tabs",
            tabs: children.map((child, i) => ({
              title: node.children![i].text || node.children![i].id,
              child,
            })),
          });
        break;
      case "form":
        components.push({
          id,
          component: "CollectionForm",
          collectionId: node.collectionId,
          ...title,
        });
        break;
      case "table":
      case "list":
        components.push({
          id,
          component: "DataTable",
          collectionId: node.collectionId,
          presentation: node.type,
          ...title,
        });
        break;
      case "chart":
        components.push({
          id,
          component: "CollectionChart",
          collectionId: node.collectionId,
          field: node.field,
          ...title,
        });
        break;
      case "button": {
        const label = unique(`${id}_label`);
        components.push({
          id: label,
          component: "Text",
          text: node.text || "Refresh data",
        });
        components.push({
          id,
          component: "Button",
          child: label,
          action: { event: { name: "paw.refresh" } },
        });
        break;
      }
      default:
        throw new Error(
          `Legacy component ${(node as Node).id} cannot be migrated. Source definition is preserved.`,
        );
    }
    return id;
  }
  const children = legacy.nodes.map(convert);
  components.push({ id: "root", component: "Column", children });
  return parseInterface({
    messages: [
      {
        version: PROTOCOL,
        createSurface: { surfaceId: "workspace", catalogId: CATALOG_ID },
      },
      {
        version: PROTOCOL,
        updateComponents: { surfaceId: "workspace", components },
      },
    ],
  });
}
