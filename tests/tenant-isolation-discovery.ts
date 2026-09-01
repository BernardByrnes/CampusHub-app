import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";

export const GOVERNED_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

export type GovernedSourceExtension =
  (typeof GOVERNED_SOURCE_EXTENSIONS)[number];

export const GOVERNED_IMPLEMENTATION_ROOTS = [
  "src/server",
  "src/application",
  "src/app/api",
] as const;

export const GOVERNED_SINGLE_FILE_PREFIXES = [
  "src/middleware",
  "src/proxy",
] as const;

export const GOVERNED_MIGRATION_ROOT = "drizzle";

const GOVERNED_EXTENSION_SET = new Set<string>(GOVERNED_SOURCE_EXTENSIONS);
const HTTP_ROUTE_OPERATIONS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const TEST_OR_SPEC_FILENAME =
  /(?:^|[._-])(test|spec|e2e)(?:[._-]|$)/i;
const TEST_OR_SPEC_DIRECTORY = /^(?:__tests__|tests?|specs?)$/i;

export type DiscoveredTenantOperation = Readonly<{
  implementationPath: string;
  operation: string;
  kind: "class_method" | "exported_function" | "route_handler";
}>;

function normalizeRepositoryPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasAllowedSourceExtension(relativePath: string): boolean {
  return GOVERNED_EXTENSION_SET.has(path.posix.extname(relativePath).toLowerCase());
}

function isTestOrSpecPath(relativePath: string): boolean {
  const normalized = normalizeRepositoryPath(relativePath);
  const segments = normalized.split("/");
  const filename = segments.at(-1) ?? "";

  return (
    segments.slice(0, -1).some((segment) => TEST_OR_SPEC_DIRECTORY.test(segment)) ||
    TEST_OR_SPEC_FILENAME.test(filename) ||
    filename.endsWith(".d.ts")
  );
}

function isUnderRoot(relativePath: string, root: string): boolean {
  return relativePath === root || relativePath.startsWith(`${root}/`);
}

function isSingleGovernedFile(relativePath: string): boolean {
  return GOVERNED_SINGLE_FILE_PREFIXES.some((prefix) =>
    GOVERNED_SOURCE_EXTENSIONS.some(
      (extension) => relativePath === `${prefix}${extension}`,
    ),
  );
}

export function isGovernedImplementationPath(relativePath: string): boolean {
  const normalized = normalizeRepositoryPath(relativePath);
  return (
    hasAllowedSourceExtension(normalized) &&
    !isTestOrSpecPath(normalized) &&
    (GOVERNED_IMPLEMENTATION_ROOTS.some((root) =>
      isUnderRoot(normalized, root),
    ) || isSingleGovernedFile(normalized))
  );
}

export function discoverGovernedImplementationPathsFromRelativePaths(
  relativePaths: readonly string[],
): string[] {
  return [...new Set(relativePaths.map(normalizeRepositoryPath))]
    .filter(isGovernedImplementationPath)
    .sort();
}

function collectFilesRecursively(
  repositoryRoot: string,
  relativeDirectory: string,
  predicate: (relativePath: string) => boolean,
  collected: string[],
): void {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) {
    return;
  }

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativeEntryPath = normalizeRepositoryPath(
      path.join(relativeDirectory, entry.name),
    );
    const absoluteEntryPath = path.join(repositoryRoot, relativeEntryPath);

    if (entry.isDirectory()) {
      collectFilesRecursively(
        repositoryRoot,
        relativeEntryPath,
        predicate,
        collected,
      );
      continue;
    }

    if (entry.isFile() && predicate(relativeEntryPath)) {
      collected.push(relativeEntryPath);
    }

    void absoluteEntryPath;
  }
}

export function discoverGovernedImplementationPaths(
  repositoryRoot: string,
): string[] {
  const discovered: string[] = [];

  for (const root of GOVERNED_IMPLEMENTATION_ROOTS) {
    collectFilesRecursively(
      repositoryRoot,
      root,
      isGovernedImplementationPath,
      discovered,
    );
  }

  for (const prefix of GOVERNED_SINGLE_FILE_PREFIXES) {
    for (const extension of GOVERNED_SOURCE_EXTENSIONS) {
      const relativePath = `${prefix}${extension}`;
      if (
        existsSync(path.join(repositoryRoot, relativePath)) &&
        isGovernedImplementationPath(relativePath)
      ) {
        discovered.push(relativePath);
      }
    }
  }

  return [...new Set(discovered)].sort();
}

function isMigrationPath(relativePath: string): boolean {
  const normalized = normalizeRepositoryPath(relativePath);
  return (
    normalized.startsWith(`${GOVERNED_MIGRATION_ROOT}/`) &&
    path.posix.extname(normalized).toLowerCase() === ".sql"
  );
}

export function discoverMigrationPathsFromRelativePaths(
  relativePaths: readonly string[],
): string[] {
  return [...new Set(relativePaths.map(normalizeRepositoryPath))]
    .filter(isMigrationPath)
    .sort();
}

export function discoverMigrationPaths(repositoryRoot: string): string[] {
  const discovered: string[] = [];
  collectFilesRecursively(
    repositoryRoot,
    GOVERNED_MIGRATION_ROOT,
    isMigrationPath,
    discovered,
  );
  return [...new Set(discovered)].sort();
}

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".cts":
      return ts.ScriptKind.JS;
    case ".mts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasModifier(
  node: ts.Node,
  modifierKind: ts.SyntaxKind,
): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return (
    ts.getModifiers(node)?.some((modifier) => modifier.kind === modifierKind) ??
    false
  );
}

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (name === undefined || ts.isPrivateIdentifier(name)) {
    return null;
  }

  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

function operationKind(
  implementationPath: string,
  operation: string,
  fallback: "class_method" | "exported_function",
): DiscoveredTenantOperation["kind"] {
  return implementationPath.startsWith("src/app/api/") &&
    HTTP_ROUTE_OPERATIONS.has(operation)
    ? "route_handler"
    : fallback;
}

export function discoverOperationsFromSource(
  implementationPath: string,
  sourceText: string,
): DiscoveredTenantOperation[] {
  const normalizedPath = normalizeRepositoryPath(implementationPath);
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(normalizedPath),
  );
  const discovered: DiscoveredTenantOperation[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const operation = statement.name?.text ?? "default";
      discovered.push({
        implementationPath: normalizedPath,
        operation,
        kind: operationKind(normalizedPath, operation, "exported_function"),
      });
    }

    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      for (const member of statement.members) {
        if (
          !ts.isMethodDeclaration(member) &&
          !ts.isGetAccessorDeclaration(member) &&
          !ts.isSetAccessorDeclaration(member)
        ) {
          continue;
        }

        if (
          hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
          hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
        ) {
          continue;
        }

        const memberName = propertyNameText(member.name);
        if (memberName === null) {
          continue;
        }

        const operation = `${statement.name.text}.${memberName}`;
        discovered.push({
          implementationPath: normalizedPath,
          operation,
          kind: operationKind(normalizedPath, operation, "class_method"),
        });
      }
    }

    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
          continue;
        }

        if (
          ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer)
        ) {
          const operation = declaration.name.text;
          discovered.push({
            implementationPath: normalizedPath,
            operation,
            kind: operationKind(normalizedPath, operation, "exported_function"),
          });
        }
      }
    }
  }

  const unique = new Map<string, DiscoveredTenantOperation>();
  for (const operation of discovered) {
    unique.set(
      `${operation.implementationPath}#${operation.operation}`,
      operation,
    );
  }

  return [...unique.values()].sort((left, right) =>
    `${left.implementationPath}#${left.operation}`.localeCompare(
      `${right.implementationPath}#${right.operation}`,
    ),
  );
}

export function discoverGovernedOperations(
  repositoryRoot: string,
  implementationPaths: readonly string[] = discoverGovernedImplementationPaths(
    repositoryRoot,
  ),
): DiscoveredTenantOperation[] {
  return implementationPaths.flatMap((implementationPath) =>
    discoverOperationsFromSource(
      implementationPath,
      readFileSync(path.join(repositoryRoot, implementationPath), "utf8"),
    ),
  );
}
