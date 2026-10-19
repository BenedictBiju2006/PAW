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
import { isAllowedOrigin } from "../apps/web/lib/origin";
test("development accepts the actual host while rejecting other origins and ports", () => {
  assert.equal(
    isAllowedOrigin(
      "http://localhost:3000",
      "http://0.0.0.0:3000",
      "localhost:3000",
      undefined,
      true,
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      "http://127.0.0.1:3000",
      "http://0.0.0.0:3000",
      "127.0.0.1:3000",
      undefined,
      true,
    ),
    true,
  );
  for (const origin of [
    null,
    "null",
    "https://attacker.example",
    "http://localhost:3001",
    "https://localhost:3000",
  ]) {
    assert.equal(
      isAllowedOrigin(
        origin,
        "http://0.0.0.0:3000",
        "localhost:3000",
        undefined,
        true,
      ),
      false,
    );
  }
});
test("production remains strict and explicit configuration takes precedence", () => {
  assert.equal(
    isAllowedOrigin(
      "http://localhost:3000",
      "http://0.0.0.0:3000",
      "localhost:3000",
      undefined,
      false,
    ),
    false,
  );
  assert.equal(
    isAllowedOrigin(
      "https://paw.example",
      "http://0.0.0.0:3000",
      "localhost:3000",
      "https://paw.example",
      false,
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      "http://localhost:3000",
      "http://localhost:3000",
      "localhost:3000",
      "https://paw.example",
      true,
    ),
    false,
  );
});
