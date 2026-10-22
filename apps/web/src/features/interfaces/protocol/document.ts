import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import {
  A2uiMessageListWrapperSchema,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v0_9";
import { isSafeRegex } from "@a2ui/web_core/v0_9/basic_catalog";
import { z } from "zod";
import type { Collection } from "../../collections/public";
import { CATALOG_ID, PROTOCOL, schemaCatalog } from "./catalog";
export type Interface = { messages: A2uiMessage[] };
export type Component = {
  id: string;
  component: string;
  [key: string]: unknown;
};
export function emptyInterface(): Interface {
  return {
    messages: [
      {
        version: PROTOCOL,
        createSurface: { surfaceId: "workspace", catalogId: CATALOG_ID },
      },
      {
        version: PROTOCOL,
        updateComponents: {
          surfaceId: "workspace",
          components: [{ id: "root", component: "Column", children: [] }],
        },
      },
    ],
  };
}
// Catalog schemas, protocol parsing, references and incremental updates are handled
// by the official processor. PAW adds resource bounds and persistence permissions.
export function parseInterface(input: unknown): Interface {
  const text = JSON.stringify(input);
  if (!text || text.length > 250000)
    throw new Error("Interface must be at most 250,000 characters.");
  const definition = A2uiMessageListWrapperSchema.parse(input) as Interface;
  if (definition.messages.length < 2 || definition.messages.length > 200)
    throw new Error("Use between 2 and 200 A2UI messages.");
  const processor = new MessageProcessor([schemaCatalog], undefined, {
    version: PROTOCOL,
    validationConfig: { ...STRICT_VALIDATION, maxDepth: 16 },
  });
  try {
    for (const message of definition.messages) {
      if (message.version !== PROTOCOL)
        throw new Error(`Use the ${PROTOCOL} protocol on every message.`);
      if (
        "createSurface" in message &&
        (message.createSurface.catalogId !== CATALOG_ID ||
          message.createSurface.theme)
      )
        throw new Error("Use the PAW catalog without custom theme overrides.");
      processor.processMessages([message]);
      if (processor.getSurfaces().size > 8)
        throw new Error("At most eight surfaces are allowed.");
      for (const surface of processor.getSurfaces().values()) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(surface.id))
          throw new Error("PAW surface IDs must be short ASCII identifiers.");
        if (surface.componentsModel.size > 200)
          throw new Error("At most 200 components per surface are allowed.");
        for (const component of surface.componentsModel.values) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(component.id))
            throw new Error(
              "PAW component IDs must be ASCII identifiers of at most 64 characters.",
            );
          if (
            component.properties.validationRegexp &&
            !isSafeRegex(component.properties.validationRegexp)
          )
            throw new Error("TextField validationRegexp is invalid or unsafe.");
          validateEvents(component.properties);
        }
      }
    }
    if (!processor.getSurfaces().size)
      throw new Error("An interface needs an active surface.");
    for (const surface of processor.getSurfaces().values())
      if (!surface.componentsModel.has("root"))
        throw new Error("Every surface needs a root component.");
    return definition;
  } finally {
    processor.dispose();
  }
}
function validateEvents(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(validateEvents);
    return;
  }
  const obj = value as Record<string, unknown>;
  if ("event" in obj) {
    const event = obj.event as Record<string, unknown>;
    if (!["paw.refresh", "paw.createRecord"].includes(String(event?.name)))
      throw new Error("Unsupported PAW action event.");
  }
  Object.values(obj).forEach(validateEvents);
}
export const interfaceSchema = z
  .unknown()
  .transform((value, ctx): Interface => {
    try {
      return parseInterface(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });
export function inspectInterface(definition: Interface) {
  const processor = new MessageProcessor([schemaCatalog], undefined, {
    version: PROTOCOL,
    validationConfig: STRICT_VALIDATION,
  });
  try {
    processor.processMessages(definition.messages);
    return [...processor.getSurfaces().values()].map((surface) => ({
      surfaceId: surface.id,
      components: [...surface.componentsModel.values].map(
        (c) => ({ id: c.id, component: c.type, ...c.properties }) as Component,
      ),
    }));
  } finally {
    processor.dispose();
  }
}
export function validateBindings(
  definition: Interface,
  collections: Collection[],
) {
  for (const surface of inspectInterface(definition))
    for (const component of surface.components) {
      if (component.collectionId) {
        const collection = collections.find(
          (c) => c.id === component.collectionId,
        );
        if (!collection)
          throw new Error(
            "Interface references a collection outside this workspace.",
          );
        if (
          component.field &&
          !collection.fields.some((f) => f.key === component.field)
        )
          throw new Error("Interface references an unknown field.");
      }
      // Static action contexts are checked here; dynamically bound contexts are
      // checked by the same authorized server service when the event is executed.
      const action = component.action as
        { event?: { context?: { collectionId?: unknown } } } | undefined;
      const target = action?.event?.context?.collectionId;
      if (
        typeof target === "string" &&
        !collections.some((c) => c.id === target)
      )
        throw new Error(
          "Action references a collection outside this workspace.",
        );
    }
}
export function isEmptyInterface(definition: Interface) {
  return inspectInterface(definition).every(
    (s) =>
      s.components.length === 1 &&
      s.components[0].component === "Column" &&
      Array.isArray(s.components[0].children) &&
      s.components[0].children.length === 0,
  );
}
export function appendComponents(
  definition: Interface,
  components: Component[],
): Interface {
  const first = inspectInterface(definition)[0];
  const root = first.components.find((c) => c.id === "root");
  if (!root || root.component !== "Column" || !Array.isArray(root.children))
    throw new Error(
      "Shortcuts need a root Column with a fixed children array. Edit the messages directly for other layouts.",
    );
  const children = [...root.children, ...components.map((c) => c.id)];
  return parseInterface({
    messages: [
      ...definition.messages,
      {
        version: PROTOCOL,
        updateComponents: {
          surfaceId: first.surfaceId,
          components: [...components, { ...root, children }],
        },
      },
    ],
  });
}
