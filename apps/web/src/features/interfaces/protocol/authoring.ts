import type { AddUiInput, UpdateUiInput } from "../model/authoring";
import { PROTOCOL } from "./catalog";
import {
  inspectInterface,
  parseInterface,
  type Component,
  type Interface,
} from "./document";

function targetSurface(definition: Interface, id?: string) {
  const surfaces = inspectInterface(definition);
  if (!id && surfaces.length !== 1)
    throw new Error(
      "Specify surfaceId when an interface has multiple surfaces.",
    );
  const surface = id
    ? surfaces.find((surface) => surface.surfaceId === id)
    : surfaces[0];
  if (!surface)
    throw new Error("UI surface not found. Inspect the current interface.");
  return {
    surfaceId: surface.surfaceId,
    components: new Map(
      surface.components.map((c) => [c.id, structuredClone(c)]),
    ),
  };
}
function parentLayout(components: Map<string, Component>, id: string) {
  const parent = components.get(id);
  if (
    !parent ||
    !["Column", "Row"].includes(parent.component) ||
    !Array.isArray(parent.children)
  )
    throw new Error(
      "Authoring placement requires an existing Column or Row with fixed children. Use raw A2UI tools for other layouts.",
    );
  return parent as Component & { children: string[] };
}
function references(component: Component): string[] {
  const refs: string[] = [];
  if (typeof component.child === "string") refs.push(component.child);
  if (Array.isArray(component.children))
    refs.push(
      ...component.children.filter(
        (id): id is string => typeof id === "string",
      ),
    );
  else if (
    component.children &&
    typeof component.children === "object" &&
    "componentId" in component.children &&
    typeof component.children.componentId === "string"
  )
    refs.push(component.children.componentId);
  if (Array.isArray(component.tabs))
    for (const tab of component.tabs)
      if (tab && typeof tab === "object" && typeof tab.child === "string")
        refs.push(tab.child);
  return refs;
}
function resolveReferences(component: Component, ids: Map<string, string>) {
  const resolve = (ref: string) => ids.get(ref) ?? ref;
  if (typeof component.child === "string")
    component.child = resolve(component.child);
  if (Array.isArray(component.children))
    component.children = component.children.map((id) =>
      typeof id === "string" ? resolve(id) : id,
    );
  else if (
    component.children &&
    typeof component.children === "object" &&
    "componentId" in component.children &&
    typeof component.children.componentId === "string"
  )
    component.children = {
      ...component.children,
      componentId: resolve(component.children.componentId),
    };
  if (Array.isArray(component.tabs))
    component.tabs = component.tabs.map((tab) =>
      tab && typeof tab === "object" && typeof tab.child === "string"
        ? { ...tab, child: resolve(tab.child) }
        : tab,
    );
}
function append(
  definition: Interface,
  surfaceId: string,
  components: Component[],
) {
  return parseInterface({
    messages: [
      ...definition.messages,
      {
        version: PROTOCOL,
        updateComponents: { surfaceId, components },
      },
    ],
  });
}
function insert(children: string[], items: string[], index?: number) {
  const position = index ?? children.length;
  if (position > children.length)
    throw new Error("Layout index is beyond the end of the parent's children.");
  children.splice(position, 0, ...items);
}
export function addUiComponents(definition: Interface, input: AddUiInput) {
  const { surfaceId, components } = targetSurface(definition, input.surfaceId);
  const layout = input.layout ?? { parentId: "root" };
  const parent = parentLayout(components, layout.parentId);
  const used = new Set(components.keys());
  const aliases = new Map<string, string>();
  let sequence = 1;
  const added = input.components.map((item) => {
    while (used.has(`ui_${sequence}`)) sequence++;
    const id = `ui_${sequence++}`;
    used.add(id);
    if (item.key) {
      if (aliases.has(item.key))
        throw new Error(`Duplicate batch key '${item.key}'.`);
      aliases.set(item.key, id);
    }
    return {
      ...structuredClone(item.properties),
      id,
      component: item.component,
    } as Component;
  });
  for (const component of added) resolveReferences(component, aliases);
  // Only unreferenced batch components attach to the parent, avoiding duplicate
  // children when a batch supplies its own Row/Column/Card hierarchy.
  const referenced = new Set(added.flatMap(references));
  const roots = added.filter((component) => !referenced.has(component.id));
  if (!roots.length)
    throw new Error(
      "The component batch has no top-level component; check for cycles.",
    );
  insert(
    parent.children,
    roots.map((component) => component.id),
    layout.index,
  );
  if (layout.direction) parent.component = layout.direction;
  return {
    definition: append(definition, surfaceId, [...added, parent]),
    surfaceId,
    components: added.map((component, index) => ({
      id: component.id,
      component: component.component,
      ...(input.components[index].key
        ? { key: input.components[index].key }
        : {}),
    })),
  };
}
export function updateUiComponent(definition: Interface, input: UpdateUiInput) {
  const { surfaceId, components } = targetSurface(definition, input.surfaceId);
  const component = components.get(input.componentId);
  if (!component)
    throw new Error("UI component not found. Inspect the current interface.");
  if (
    [...Object.keys(input.properties), ...input.removeProperties].some((key) =>
      ["id", "component"].includes(key),
    )
  )
    throw new Error(
      "Component ID and type cannot be changed by a property patch.",
    );
  if (
    input.removeProperties.some((key) => Object.hasOwn(input.properties, key))
  )
    throw new Error("Do not set and remove the same property in one update.");
  const patched = {
    ...component,
    ...structuredClone(input.properties),
  } as Component;
  for (const key of input.removeProperties) delete patched[key];
  components.set(patched.id, patched);
  const changed = new Map([[patched.id, patched]]);
  if (input.placement) {
    if (component.id === "root")
      throw new Error("The root component cannot be moved.");
    const incoming = [...components.values()].filter((c) =>
      references(c).includes(component.id),
    );
    if (incoming.length !== 1)
      throw new Error("Moving a shared component requires raw A2UI tools.");
    const oldParent = parentLayout(components, incoming[0].id);
    const newParent = parentLayout(components, input.placement.parentId);
    if (oldParent.children.filter((id) => id === component.id).length !== 1)
      throw new Error(
        "Moving repeated child references requires raw A2UI tools.",
      );
    oldParent.children = oldParent.children.filter((id) => id !== component.id);
    insert(newParent.children, [component.id], input.placement.index);
    changed.set(oldParent.id, oldParent);
    changed.set(newParent.id, newParent);
  }
  return {
    definition: append(definition, surfaceId, [...changed.values()]),
    surfaceId,
    componentId: component.id,
  };
}
