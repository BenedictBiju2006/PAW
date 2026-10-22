export {
  CATALOG_ID,
  CollectionChartApi,
  CollectionFormApi,
  DataTableApi,
  PROTOCOL,
  catalogComponents,
  catalogDocument,
  componentApis,
  schemaCatalog,
} from "./protocol/catalog";
export {
  appendComponents,
  emptyInterface,
  inspectInterface,
  interfaceSchema,
  isEmptyInterface,
  parseInterface,
  validateBindings,
} from "./protocol/document";
export type { Component, Interface } from "./protocol/document";
export { upgradeInterface } from "./protocol/legacy";
