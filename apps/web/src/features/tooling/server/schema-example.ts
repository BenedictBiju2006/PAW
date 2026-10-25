import "server-only";
/** Syntax example from registry JSON schema. Resource IDs must be replaced with
 * authorized IDs; this never supplies execution arguments automatically. */
export function schemaExample(input: unknown, depth = 0): unknown {
  if (!input || typeof input !== "object" || depth > 6) return null;
  const s = input as Record<string, unknown>;
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (Array.isArray(s.anyOf) && s.anyOf.length)
    return schemaExample(s.anyOf[0], depth + 1);
  if (s.type === "object") {
    const properties = s.properties as Record<string, unknown> | undefined;
    const required = Array.isArray(s.required)
      ? s.required.filter((key): key is string => typeof key === "string")
      : [];
    return Object.fromEntries(
      required.map((key) => [key, schemaExample(properties?.[key], depth + 1)]),
    );
  }
  if (s.type === "array")
    return Array.from(
      { length: Math.min(3, typeof s.minItems === "number" ? s.minItems : 0) },
      () => schemaExample(s.items, depth + 1),
    );
  if (s.type === "integer" || s.type === "number") return s.minimum ?? 1;
  if (s.type === "boolean") return false;
  if (s.format === "uuid") return "11111111-1111-4111-8111-111111111111";
  if (s.type === "string") return "example";
  return null;
}
