import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
const root = resolve("apps/web/src");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory()
      ? files(path)
      : /\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}
const sources = [...files(root), ...files(resolve("apps/web/app"))];
const privilegedImports = new Map();
const errors = [];
const runtime = new Map();
const clients = [];
const owner = (path) => relative(root, path).split(sep)[1];
const feature = (path) => relative(root, path).startsWith(`features${sep}`);
const allowed = {
  auth: [],
  providers: [],
  tooling: [],
  collections: ["workspaces", "tooling"],
  interfaces: ["collections", "workspaces", "tooling"],
  workspaces: ["auth", "collections", "interfaces", "chat", "tooling"],
  chat: ["providers", "workspaces", "agent"],
  agent: ["providers", "tooling", "chat"],
};
function target(from, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return;
  const base = specifier.startsWith("@/")
    ? resolve(root, specifier.slice(2))
    : resolve(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`].find((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
for (const file of sources) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const deps = [];
  if (
    source.statements.some(
      (n) => ts.isExpressionStatement(n) && n.expression.text === "use client",
    )
  )
    clients.push(file);
  function edge(specifier, typeOnly) {
    if (
      !typeOnly &&
      [
        "server-only",
        "node:crypto",
        "crypto",
        "next/headers",
        "@supabase/ssr",
        "@ai-sdk/google",
        "@ai-sdk/openai",
        "@ai-sdk/groq",
      ].includes(specifier)
    )
      privilegedImports.set(file, specifier);
    const dest = target(file, specifier);
    if (!dest) return;
    if (
      relative(root, file).startsWith(`shared${sep}`) &&
      !relative(root, dest).startsWith(`shared${sep}`)
    )
      errors.push(
        `Shared infrastructure imports application code: ${relative(root, file)}`,
      );
    if (feature(file) && relative(root, dest).startsWith(`composition${sep}`))
      errors.push(`Feature imports composition root: ${relative(root, file)}`);
    if (!feature(file) && feature(dest)) {
      const contract = relative(
        resolve(root, "features", owner(dest)),
        dest,
      ).replaceAll(sep, "/");
      if (!["public.ts", "client.ts", "server/public.ts"].includes(contract))
        errors.push(
          `Entrypoint imports private feature code: ${relative(root, file)} -> ${contract}`,
        );
    }
    if (feature(file) && feature(dest) && owner(file) !== owner(dest)) {
      if (!allowed[owner(file)]?.includes(owner(dest)))
        errors.push(
          `Forbidden feature dependency: ${owner(file)} -> ${owner(dest)}`,
        );
      const contract = relative(
        resolve(root, "features", owner(dest)),
        dest,
      ).replaceAll(sep, "/");
      if (!["public.ts", "client.ts", "server/public.ts"].includes(contract))
        errors.push(
          `Private cross-feature import: ${relative(root, file)} -> ${contract}`,
        );
    }
    if (!typeOnly) deps.push(dest);
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const clause = ts.isImportDeclaration(node)
        ? node.importClause
        : undefined;
      const onlyNamedTypes =
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((n) => n.isTypeOnly);
      edge(
        node.moduleSpecifier.text,
        node.isTypeOnly || clause?.isTypeOnly || onlyNamedTypes,
      );
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      edge(node.arguments[0].text, false);
    ts.forEachChild(node, visit);
  }
  visit(source);
  runtime.set(file, deps);
  if (
    (file.includes(`${sep}server${sep}`) && !file.endsWith(`${sep}types.ts`)) ||
    ["privileged.ts", "supabase.ts"].some((n) =>
      file.endsWith(`${sep}db${sep}${n}`),
    )
  ) {
    const hasRuntime = source.statements.some(
      (n) =>
        ts.isClassDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isVariableStatement(n) ||
        (ts.isExportDeclaration(n) && !n.isTypeOnly),
    );
    if (
      hasRuntime &&
      !source.statements.some(
        (n) =>
          ts.isImportDeclaration(n) && n.moduleSpecifier.text === "server-only",
      )
    )
      errors.push(`Missing server-only guard: ${relative(root, file)}`);
  }
}
const complete = new Set(),
  stack = [];
function cycle(file) {
  if (stack.includes(file)) {
    errors.push(
      `Runtime cycle: ${[...stack.slice(stack.indexOf(file)), file].map((p) => relative(root, p)).join(" -> ")}`,
    );
    return;
  }
  if (complete.has(file)) return;
  stack.push(file);
  for (const dep of runtime.get(file) ?? []) cycle(dep);
  stack.pop();
  complete.add(file);
}
for (const file of sources) cycle(file);
for (const client of clients) {
  const seen = new Set();
  function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    if (privilegedImports.has(file))
      errors.push(
        `Client reaches privileged import: ${relative(root, client)} -> ${privilegedImports.get(file)}`,
      );
    if (
      file.includes(`${sep}server${sep}`) ||
      file.endsWith(`${sep}db${sep}privileged.ts`) ||
      file.endsWith(`${sep}db${sep}supabase.ts`)
    )
      errors.push(
        `Client reaches server code: ${relative(root, client)} -> ${relative(root, file)}`,
      );
    for (const dep of runtime.get(file) ?? []) walk(dep);
  }
  walk(client);
}
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Architecture boundaries passed: ${sources.length} modules, ${clients.length} client roots, no runtime cycles or client/server leaks.`,
  );
