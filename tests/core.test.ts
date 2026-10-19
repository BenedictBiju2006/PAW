import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fieldsSchema,
  interfaceSchema,
  validateBindings,
  validateData,
} from "../packages/core/schema";
const fields = fieldsSchema.parse([
  { key: "title", label: "Title", type: "string", required: true },
  { key: "rating", label: "Rating", type: "number" },
  { key: "watched", label: "Watched", type: "boolean" },
  { key: "date", label: "Date", type: "date" },
  { key: "status", label: "Status", type: "enum", options: ["New", "Done"] },
]);
test("typed record validation preserves false, zero, and optional nulls", () => {
  assert.deepEqual(
    validateData(fields, {
      title: "A film",
      rating: 0,
      watched: false,
      date: "2024-02-29",
      status: "Done",
    }),
    {
      title: "A film",
      rating: 0,
      watched: false,
      date: "2024-02-29",
      status: "Done",
    },
  );
  assert.deepEqual(validateData(fields, { title: "A film", rating: null }), {
    title: "A film",
    rating: null,
  });
});
test("rejects missing required fields, invalid dates, unknown keys, and wrong types", () => {
  for (const value of [
    {},
    { title: "" },
    { title: "A", date: "2025-02-29" },
    { title: "A", rating: "5" },
    { title: "A", status: "Other" },
    { title: "A", surprise: 1 },
  ])
    assert.throws(() => validateData(fields, value));
});
test("collection schemas reject duplicate keys and invalid enum options", () => {
  assert.throws(() => fieldsSchema.parse([fields[0], fields[0]]));
  assert.throws(() =>
    fieldsSchema.parse([
      { key: "state", label: "State", type: "enum", options: [] },
    ]),
  );
  assert.throws(() =>
    fieldsSchema.parse([
      { key: "state", label: "State", type: "enum", options: ["A", "A"] },
    ]),
  );
});
test("interface accepts only trusted components with unique ids and bounded nesting", () => {
  assert.deepEqual(interfaceSchema.parse({ version: 1, nodes: [] }), {
    version: 1,
    nodes: [],
  });
  for (const nodes of [
    [{ id: "x", type: "script" }],
    [
      { id: "x", type: "text", text: "A" },
      { id: "x", type: "text" },
    ],
    [{ id: "x", type: "table" }],
    [{ id: "x", type: "text", children: [{ id: "y", type: "text" }] }],
  ])
    assert.throws(() => interfaceSchema.parse({ version: 1, nodes }));
  let node: any = { id: "leaf", type: "text" };
  for (let i = 0; i < 9; i++)
    node = { id: `c${i}`, type: "container", children: [node] };
  assert.throws(() => interfaceSchema.parse({ version: 1, nodes: [node] }));
});
test("bindings reject foreign collections and unknown chart fields", () => {
  const collectionId = "11111111-1111-4111-8111-111111111111";
  const definition = interfaceSchema.parse({
    version: 1,
    nodes: [{ id: "table", type: "table", collectionId }],
  });
  assert.throws(() => validateBindings(definition, []));
  const collections = [
    { id: collectionId, workspace_id: collectionId, name: "Films", fields },
  ];
  assert.doesNotThrow(() => validateBindings(definition, collections));
  assert.throws(() =>
    validateBindings(
      {
        version: 1,
        nodes: [{ id: "chart", type: "chart", collectionId, field: "missing" }],
      },
      collections,
    ),
  );
});
