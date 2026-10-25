import { catalogComponents, componentApis } from "./catalog";

const collectionId = "11111111-1111-4111-8111-111111111111";
// Explanatory examples only. Required properties, types and validation come from
// the live official catalog, never a second component schema.
const hints: Record<
  string,
  {
    description: string;
    useCases: string[];
    properties: Record<string, unknown>;
  }
> = {
  Text: {
    description: "Plain text or a heading.",
    useCases: ["heading", "title", "description"],
    properties: { text: "Movies", variant: "h2" },
  },
  Column: {
    description: "Vertical layout of component references.",
    useCases: ["stack", "section", "vertical layout"],
    properties: { children: ["content"] },
  },
  Row: {
    description: "Horizontal layout of component references.",
    useCases: ["side by side", "horizontal layout"],
    properties: { children: ["content"] },
  },
  Card: {
    description: "A bordered container for one child.",
    useCases: ["group", "panel", "section"],
    properties: { child: "content" },
  },
  DataTable: {
    description:
      "Editable persistent records; columns come from the collection schema.",
    useCases: ["movies", "ranking", "table", "list", "sort", "edit records"],
    properties: { collectionId },
  },
  CollectionForm: {
    description: "Record entry form; fields come from the collection schema.",
    useCases: ["movies", "create record", "form", "data entry"],
    properties: { collectionId },
  },
  CollectionChart: {
    description: "Value counts across a collection field.",
    useCases: ["movies", "ranking", "chart", "aggregate", "ratings"],
    properties: { collectionId, field: "rating" },
  },
  Button: {
    description: "A child label and a supported PAW action.",
    useCases: ["refresh", "action"],
    properties: {
      child: "content",
      action: { event: { name: "paw.refresh" } },
    },
  },
  TextField: {
    description: "Text input with optional transient data binding.",
    useCases: ["input", "draft", "text"],
    properties: { label: "Title" },
  },
  CheckBox: {
    description: "Boolean input with optional transient data binding.",
    useCases: ["boolean", "toggle", "checkbox"],
    properties: { label: "Watched", value: false },
  },
  Tabs: {
    description: "Labeled tabs referencing child components.",
    useCases: ["tabs", "pages", "sections"],
    properties: { tabs: [{ title: "Overview", child: "content" }] },
  },
  List: {
    description: "Fixed children or an official data-model list template.",
    useCases: ["list", "repeat", "layout"],
    properties: { children: ["content"] },
  },
  Divider: {
    description: "A separator between sections.",
    useCases: ["separator", "line"],
    properties: {},
  },
};
export function componentSummary(name: string) {
  const api = componentApis.find((api) => api.name === name);
  if (!api)
    throw new Error(
      `Unknown UI component '${name}'. Use search_ui_components.`,
    );
  const hint = hints[name];
  return {
    component: name,
    description: hint?.description ?? api.schema.description ?? name,
    requiredProperties: Object.entries(api.schema.shape)
      .filter(([, schema]) => !schema.isOptional())
      .map(([key]) => key),
    useCases: hint?.useCases ?? [],
    exampleProperties: hint?.properties ?? {},
  };
}
export function searchUiComponents(query: string, limit = 10) {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return componentApis
    .map((api) => {
      const summary = componentSummary(api.name);
      const text = JSON.stringify(summary).toLowerCase();
      return {
        summary,
        score: words.filter((word) => text.includes(word)).length,
      };
    })
    .filter((item) => !words.length || item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.summary.component.localeCompare(b.summary.component),
    )
    .slice(0, limit)
    .map((item) => item.summary);
}
export function componentAuthoringExample(name: string) {
  const summary = componentSummary(name);
  const needsChild = [
    "Column",
    "Row",
    "Card",
    "Button",
    "Tabs",
    "List",
  ].includes(name);
  return {
    ...summary,
    schema: catalogComponents()[name],
    example: {
      components: [
        ...(needsChild
          ? [
              {
                key: "content",
                component: "Text",
                properties: { text: "Content" },
              },
            ]
          : []),
        {
          key: "example",
          component: name,
          properties: summary.exampleProperties,
        },
      ],
      layout: { parentId: "root" },
    },
    notes:
      "Replace the example collectionId with an authorized collection ID and the chart field with a real field key. Child references use local batch keys or existing component IDs. DataTable does not accept columns; CollectionForm does not accept fields. Persistent data stays in collections. Use inspect_interface for current IDs/revision; inspect_resource reads resources, not UI component discovery.",
  };
}
