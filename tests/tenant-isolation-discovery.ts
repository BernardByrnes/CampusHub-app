import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";

import {
  REVIEWED_NON_CALLABLE_REEXPORT_CONTRACTS,
  REVIEWED_NON_CALLABLE_EXPORT_CONTRACTS,
  REVIEWED_NON_OPERATIONAL_CONSTRUCTOR_CONTRACTS,
} from "@/server/tenancy/tenant-surface-registry";

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

export type DiscoveredUnsupportedOperationForm = Readonly<{
  implementationPath: string;
  description: string;
}>;

export type SourceFileForImportBoundary = Readonly<{
  relativePath: string;
  sourceText: string;
}>;

export type ProductionImportBoundaryViolation = Readonly<{
  fromPath: string;
  specifier: string;
  resolvedPath: string;
}>;

function normalizeRepositoryPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasAllowedSourceExtension(relativePath: string): boolean {
  return GOVERNED_EXTENSION_SET.has(path.posix.extname(relativePath).toLowerCase());
}

export function isExcludedTestOrSpecPath(relativePath: string): boolean {
  const normalized = normalizeRepositoryPath(relativePath);
  const segments = normalized.split("/");
  const filename = segments.at(-1) ?? "";

  return (
    segments.slice(0, -1).some((segment) => TEST_OR_SPEC_DIRECTORY.test(segment)) ||
    TEST_OR_SPEC_FILENAME.test(filename) ||
    filename.endsWith(".d.ts")
  );
}

function isTestOrSpecPath(relativePath: string): boolean {
  return isExcludedTestOrSpecPath(relativePath);
}

function isProductionSourcePath(relativePath: string): boolean {
  const normalized = normalizeRepositoryPath(relativePath);
  return (
    normalized.startsWith("src/") &&
    hasAllowedSourceExtension(normalized) &&
    !isExcludedTestOrSpecPath(normalized)
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
  excludedDirectories: ReadonlySet<string> = new Set<string>(),
): void {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) {
    return;
  }

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativeEntryPath = normalizeRepositoryPath(
      path.join(relativeDirectory, entry.name),
    );

    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) {
        continue;
      }
      collectFilesRecursively(
        repositoryRoot,
        relativeEntryPath,
        predicate,
        collected,
        excludedDirectories,
      );
      continue;
    }

    if (entry.isFile() && predicate(relativeEntryPath)) {
      collected.push(relativeEntryPath);
    }
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
      return ts.ScriptKind.JS;
    case ".ts":
    case ".mts":
    case ".cts":
    default:
      return ts.ScriptKind.TS;
  }
}

function hasModifier(node: ts.Node, modifierKind: ts.SyntaxKind): boolean {
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

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }

    return current;
  }
}

type ResolvedBinding =
  | ts.ClassDeclaration
  | ts.Expression
  | ts.FunctionDeclaration;

type BindingDeclaration =
  | ts.ClassDeclaration
  | ts.FunctionDeclaration
  | ts.VariableDeclaration;

function createTopLevelBindings(
  sourceFile: ts.SourceFile,
): Map<string, BindingDeclaration> {
  const bindings = new Map<string, BindingDeclaration>();

  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      bindings.set(statement.name.text, statement);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          bindings.set(declaration.name.text, declaration);
        }
      }
    }
  }

  return bindings;
}

type ExportedBindingNames = ReadonlyMap<string, readonly string[]>;

function addExportedBindingName(
  bindings: Map<string, string[]>,
  localName: string,
  exportedName: string,
): void {
  const names = bindings.get(localName) ?? [];
  if (!names.includes(exportedName)) {
    names.push(exportedName);
    bindings.set(localName, names);
  }
}

function collectExportedBindingNames(
  sourceFile: ts.SourceFile,
): Map<string, string[]> {
  const bindings = new Map<string, string[]>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          addExportedBindingName(
            bindings,
            declaration.name.text,
            declaration.name.text,
          );
        }
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        if (specifier.isTypeOnly) {
          continue;
        }
        const exportedName = specifier.name.text;
        const localName = specifier.propertyName?.text ?? exportedName;
        if (localName !== "default") {
          addExportedBindingName(bindings, localName, exportedName);
        }
      }
    }

    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      addExportedBindingName(
        bindings,
        statement.expression.text,
        "default",
      );
    }
  }

  return bindings;
}

function resolveBinding(
  name: string,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  seen = new Set<string>(),
): ResolvedBinding | undefined {
  if (seen.has(name)) {
    return undefined;
  }
  seen.add(name);

  const binding = bindings.get(name);
  if (binding === undefined) {
    return undefined;
  }
  if (ts.isClassDeclaration(binding) || ts.isFunctionDeclaration(binding)) {
    return binding;
  }
  if (binding.initializer === undefined) {
    return undefined;
  }

  const expression = unwrapExpression(binding.initializer);
  if (ts.isIdentifier(expression)) {
    return resolveBinding(expression.text, bindings, seen);
  }
  return expression;
}

function isCallableExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped);
}

function astFormForExpression(expression: ts.Expression): string {
  return ts.SyntaxKind[unwrapExpression(expression).kind];
}

function isReviewedNonCallableExport(
  implementationPath: string,
  exportName: string,
  expression: ts.Expression,
): boolean {
  const expectedAstForm = astFormForExpression(expression);
  return REVIEWED_NON_CALLABLE_EXPORT_CONTRACTS.some(
    (contract) =>
      contract.implementationPath === implementationPath &&
      contract.exportName === exportName &&
      contract.expectedAstForm === expectedAstForm,
  );
}

function isReviewedNonCallableReExport(
  implementationPath: string,
  moduleSpecifier: string,
  exportForm: string,
): boolean {
  return REVIEWED_NON_CALLABLE_REEXPORT_CONTRACTS.some(
    (contract) =>
      contract.implementationPath === implementationPath &&
      contract.moduleSpecifier === moduleSpecifier &&
      contract.exportForm === exportForm,
  );
}

function isReviewedNonOperationalConstructor(
  implementationPath: string,
  classIdentity: string,
): boolean {
  return REVIEWED_NON_OPERATIONAL_CONSTRUCTOR_CONTRACTS.some(
    (contract) =>
      contract.implementationPath === implementationPath &&
      contract.classIdentity === classIdentity,
  );
}

function isStaticallyNonCallableExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isArrayLiteralExpression(unwrapped) ||
    ts.isLiteralExpression(unwrapped) ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
    (ts.isIdentifier(unwrapped) &&
      ["Infinity", "NaN", "undefined"].includes(unwrapped.text))
  );
}

function addOperation(
  discovered: DiscoveredTenantOperation[],
  implementationPath: string,
  operation: string,
  fallback: "class_method" | "exported_function",
): void {
  if (operation.length === 0) {
    return;
  }

  discovered.push({
    implementationPath,
    operation,
    kind: operationKind(implementationPath, operation, fallback),
  });
}

function addUnsupportedOperationForm(
  unsupported: DiscoveredUnsupportedOperationForm[],
  implementationPath: string,
  description: string,
): void {
  unsupported.push({ implementationPath, description });
}

function addUnresolvedExposedValue(
  implementationPath: string,
  exportName: string,
  expression: ts.Expression,
  unsupported: DiscoveredUnsupportedOperationForm[],
  description: string,
): void {
  if (isReviewedNonCallableExport(implementationPath, exportName, expression)) {
    return;
  }

  addUnsupportedOperationForm(
    unsupported,
    implementationPath,
    `${description}; unresolved ${astFormForExpression(expression)} is not an approved non-callable export`,
  );
}

function recordExposedExpression(
  implementationPath: string,
  prefix: string,
  expression: ts.Expression,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions = new Set<ts.Node>(),
): void {
  const unwrapped = unwrapExpression(expression);

  if (isReviewedNonCallableExport(implementationPath, prefix, unwrapped)) {
    return;
  }

  if (isCallableExpression(unwrapped)) {
    addOperation(discovered, implementationPath, prefix, "exported_function");
    return;
  }

  if (ts.isClassExpression(unwrapped)) {
    if (visitedExpressions.has(unwrapped)) {
      return;
    }
    const nextVisitedExpressions = new Set(visitedExpressions);
    nextVisitedExpressions.add(unwrapped);
    discoverClassOperations(
      implementationPath,
      unwrapped,
      prefix,
      bindings,
      discovered,
      unsupported,
      nextVisitedExpressions,
      true,
    );
    return;
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    discoverObjectOperations(
      implementationPath,
      unwrapped,
      prefix,
      bindings,
      discovered,
      unsupported,
      visitedExpressions,
    );
    return;
  }

  if (ts.isIdentifier(unwrapped)) {
    if (visitedExpressions.has(unwrapped)) {
      return;
    }
    const nextVisitedExpressions = new Set(visitedExpressions);
    nextVisitedExpressions.add(unwrapped);
    const resolved = resolveBinding(unwrapped.text, bindings);
    if (resolved === undefined) {
      addUnresolvedExposedValue(
        implementationPath,
        prefix,
        unwrapped,
        unsupported,
        `exported/public value ${prefix} cannot be resolved to a known AST value`,
      );
      return;
    }
    recordResolvedValue(
      implementationPath,
      prefix,
      resolved,
      bindings,
      discovered,
      unsupported,
      nextVisitedExpressions,
    );
    return;
  }

  if (isStaticallyNonCallableExpression(unwrapped)) {
    return;
  }

  if (visitedExpressions.has(unwrapped)) {
    return;
  }
  addUnresolvedExposedValue(
    implementationPath,
    prefix,
    unwrapped,
    unsupported,
    `exported/public value ${prefix} is not statically proven non-callable`,
  );
}

function recordResolvedValue(
  implementationPath: string,
  prefix: string,
  resolved: ResolvedBinding | undefined,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions = new Set<ts.Node>(),
): void {
  if (resolved === undefined) {
    return;
  }

  if (ts.isFunctionDeclaration(resolved)) {
    addOperation(discovered, implementationPath, prefix, "exported_function");
    return;
  }

  if (ts.isClassDeclaration(resolved)) {
    discoverClassOperations(
      implementationPath,
      resolved,
      prefix,
      bindings,
      discovered,
      unsupported,
      visitedExpressions,
      true,
    );
    return;
  }

  recordExposedExpression(
    implementationPath,
    prefix,
    resolved,
    bindings,
    discovered,
    unsupported,
    visitedExpressions,
  );
}

function recordExportedValue(
  implementationPath: string,
  prefix: string,
  expression: ts.Expression,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions = new Set<ts.Node>(),
): void {
  recordExposedExpression(
    implementationPath,
    prefix,
    expression,
    bindings,
    discovered,
    unsupported,
    visitedExpressions,
  );
}

function discoverClassOperations(
  implementationPath: string,
  classDeclaration: ts.ClassDeclaration | ts.ClassExpression,
  classIdentity: string,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions = new Set<ts.Node>(),
  includeConstructor = false,
): void {
  const constructor = classDeclaration.members.find((member) =>
    ts.isConstructorDeclaration(member),
  );
  const isConstructible =
    constructor === undefined ||
    (!hasModifier(constructor, ts.SyntaxKind.PrivateKeyword) &&
      !hasModifier(constructor, ts.SyntaxKind.ProtectedKeyword));
  if (
    includeConstructor &&
    isConstructible &&
    !isReviewedNonOperationalConstructor(implementationPath, classIdentity)
  ) {
    addOperation(
      discovered,
      implementationPath,
      `${classIdentity}.constructor`,
      "class_method",
    );
  }

  for (const member of classDeclaration.members) {
    if (
      hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
      hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
    ) {
      continue;
    }

    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      if (ts.isPrivateIdentifier(member.name)) {
        continue;
      }
      const memberName = propertyNameText(member.name);
      if (memberName === null) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `public class callable member in ${classIdentity} has an unresolved computed name`,
        );
        continue;
      }
      if (member.body === undefined) {
        continue;
      }
      addOperation(
        discovered,
        implementationPath,
        `${classIdentity}.${memberName}`,
        "class_method",
      );
      continue;
    }

    if (!ts.isPropertyDeclaration(member)) {
      continue;
    }

    if (ts.isPrivateIdentifier(member.name)) {
      continue;
    }
    const memberName = propertyNameText(member.name);
    if (memberName === null) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `public class field in ${classIdentity} has an unresolved computed name`,
      );
      continue;
    }

    const operation = `${classIdentity}.${memberName}`;
    if (member.initializer === undefined) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `public class field ${operation} has no initializer that proves its value is non-callable`,
      );
      continue;
    }

    recordExposedExpression(
      implementationPath,
      operation,
      member.initializer,
      bindings,
      discovered,
      unsupported,
      visitedExpressions,
    );
  }
}

function recordObjectMemberValue(
  implementationPath: string,
  prefix: string,
  value: ts.Expression,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions: Set<ts.Node>,
): void {
  recordExposedExpression(
    implementationPath,
    prefix,
    value,
    bindings,
    discovered,
    unsupported,
    visitedExpressions,
  );
}

function discoverObjectOperations(
  implementationPath: string,
  objectLiteral: ts.ObjectLiteralExpression,
  prefix: string,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions = new Set<ts.Node>(),
): void {
  if (visitedExpressions.has(objectLiteral)) {
    return;
  }
  const nextVisitedExpressions = new Set(visitedExpressions);
  nextVisitedExpressions.add(objectLiteral);

  for (const property of objectLiteral.properties) {
    if (
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      if (property.body === undefined) {
        continue;
      }
      const memberName = propertyNameText(property.name);
      if (memberName === null) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `exported object ${prefix} has a callable member with an unresolved computed name`,
        );
      } else {
        addOperation(
          discovered,
          implementationPath,
          `${prefix}.${memberName}`,
          "exported_function",
        );
      }
      continue;
    }

    if (ts.isPropertyAssignment(property)) {
      const memberName = propertyNameText(property.name);
      if (memberName === null) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `exported object ${prefix} has a public property with an unresolved computed name`,
        );
      } else {
        recordObjectMemberValue(
          implementationPath,
          `${prefix}.${memberName}`,
          property.initializer,
          bindings,
          discovered,
          unsupported,
          nextVisitedExpressions,
        );
      }
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const memberName = property.name.text;
      recordObjectMemberValue(
        implementationPath,
        `${prefix}.${memberName}`,
        property.name,
        bindings,
        discovered,
        unsupported,
        nextVisitedExpressions,
      );
      continue;
    }

    if (ts.isSpreadAssignment(property)) {
      const spreadExpression = unwrapExpression(property.expression);
      if (ts.isIdentifier(spreadExpression)) {
        const resolved = resolveBinding(spreadExpression.text, bindings);
        if (resolved !== undefined) {
          recordResolvedValue(
            implementationPath,
            prefix,
            resolved,
            bindings,
            discovered,
            unsupported,
            nextVisitedExpressions,
          );
          continue;
        }
      }
      if (ts.isObjectLiteralExpression(spreadExpression)) {
        discoverObjectOperations(
          implementationPath,
          spreadExpression,
          prefix,
          bindings,
          discovered,
          unsupported,
          nextVisitedExpressions,
        );
        continue;
      }
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `exported object ${prefix} contains an unresolved spread`,
      );
    }
  }
}

function isModuleExportsExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return (
      ts.isIdentifier(unwrapped.expression) &&
      unwrapped.expression.text === "module" &&
      unwrapped.name.text === "exports"
    );
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    return (
      ts.isIdentifier(unwrapped.expression) &&
      unwrapped.expression.text === "module" &&
      ts.isStringLiteral(unwrapped.argumentExpression) &&
      unwrapped.argumentExpression.text === "exports"
    );
  }
  return false;
}

type CommonJsExportTarget = Readonly<{
  isExportSurface: boolean;
  operation: string | null;
}>;

function commonJsExportTarget(expression: ts.Expression): CommonJsExportTarget {
  const unwrapped = unwrapExpression(expression);
  if (isModuleExportsExpression(unwrapped)) {
    return { isExportSurface: true, operation: "default" };
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = unwrapExpression(unwrapped.expression);
    if (ts.isIdentifier(base) && base.text === "exports") {
      return { isExportSurface: true, operation: unwrapped.name.text };
    }
    if (isModuleExportsExpression(base)) {
      return { isExportSurface: true, operation: unwrapped.name.text };
    }
    return { isExportSurface: false, operation: null };
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    const base = unwrapExpression(unwrapped.expression);
    const isExportsObject =
      (ts.isIdentifier(base) && base.text === "exports") ||
      isModuleExportsExpression(base);
    if (!isExportsObject) {
      return { isExportSurface: false, operation: null };
    }

    const argument = unwrapped.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
      return { isExportSurface: true, operation: argument.text };
    }
    return { isExportSurface: true, operation: null };
  }

  return { isExportSurface: false, operation: null };
}

function collectCommonJsExportedBindingNames(
  sourceFile: ts.SourceFile,
  bindings: Map<string, string[]>,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      commonJsExportTarget(node.left).operation === "default"
    ) {
      const right = unwrapExpression(node.right);
      if (ts.isIdentifier(right)) {
        addExportedBindingName(bindings, right.text, "default");
      }
    }
    ts.forEachChild(node, visit);
  };

  sourceFile.forEachChild(visit);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

type ExportedMemberTarget = Readonly<{
  localName: string;
  memberName: string | null;
  computed: boolean;
}>;

function exportedMemberTarget(
  expression: ts.Expression,
): ExportedMemberTarget | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = unwrapExpression(unwrapped.expression);
    return ts.isIdentifier(base)
      ? {
          localName: base.text,
          memberName: unwrapped.name.text,
          computed: false,
        }
      : null;
  }

  if (!ts.isElementAccessExpression(unwrapped)) {
    return null;
  }

  const base = unwrapExpression(unwrapped.expression);
  if (!ts.isIdentifier(base)) {
    return null;
  }

  const argument = unwrapped.argumentExpression;
  if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
    return {
      localName: base.text,
      memberName: argument.text,
      computed: false,
    };
  }

  return {
    localName: base.text,
    memberName: null,
    computed: true,
  };
}

function discoverExportedBindingMutation(
  implementationPath: string,
  assignment: ts.BinaryExpression,
  exportedBindings: ExportedBindingNames,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  if (!isAssignmentOperator(assignment.operatorToken.kind)) {
    return;
  }

  const left = unwrapExpression(assignment.left);
  if (ts.isIdentifier(left)) {
    const exportNames = exportedBindings.get(left.text);
    if (exportNames === undefined) {
      return;
    }
    for (const exportName of exportNames) {
      recordExportedValue(
        implementationPath,
        exportName,
        assignment.right,
        bindings,
        discovered,
        unsupported,
      );
    }
    return;
  }

  const target = exportedMemberTarget(left);
  if (target === null) {
    return;
  }

  const exportNames = exportedBindings.get(target.localName);
  if (exportNames === undefined) {
    return;
  }

  for (const exportName of exportNames) {
    if (target.computed || target.memberName === null) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `exported object ${exportName} has a computed late mutation that cannot be resolved safely`,
      );
      continue;
    }

    recordExposedExpression(
      implementationPath,
      `${exportName}.${target.memberName}`,
      assignment.right,
      bindings,
      discovered,
      unsupported,
    );
  }
}

function discoverCommonJsAssignment(
  implementationPath: string,
  assignment: ts.BinaryExpression,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  if (!isAssignmentOperator(assignment.operatorToken.kind)) {
    return;
  }

  const target = commonJsExportTarget(assignment.left);
  if (!target.isExportSurface) {
    return;
  }

  if (target.operation === null) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      "CommonJS export has an unresolved computed member name",
    );
    return;
  }

  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      `CommonJS export ${target.operation} uses a non-simple assignment operator`,
    );
    return;
  }

  recordExportedValue(
    implementationPath,
    target.operation,
    assignment.right,
    bindings,
    discovered,
    unsupported,
  );
}

function analyzeSource(
  implementationPath: string,
  sourceText: string,
): {
  operations: DiscoveredTenantOperation[];
  unsupported: DiscoveredUnsupportedOperationForm[];
} {
  const normalizedPath = normalizeRepositoryPath(implementationPath);
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(normalizedPath),
  );
  const bindings = createTopLevelBindings(sourceFile);
  const exportedBindings = collectExportedBindingNames(sourceFile);
  collectCommonJsExportedBindingNames(sourceFile, exportedBindings);
  const discovered: DiscoveredTenantOperation[] = [];
  const unsupported: DiscoveredUnsupportedOperationForm[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const operation = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
        ? "default"
        : statement.name?.text ?? "default";
      addOperation(discovered, normalizedPath, operation, "exported_function");
    }

    if (ts.isClassDeclaration(statement)) {
      const classIdentity =
        statement.name?.text ??
        (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
          ? `default@${normalizedPath}`
          : null);
      if (classIdentity !== null) {
        discoverClassOperations(
          normalizedPath,
          statement,
          classIdentity,
          bindings,
          discovered,
          unsupported,
          new Set<ts.Node>(),
          hasModifier(statement, ts.SyntaxKind.ExportKeyword),
        );
      }
    }

    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          addUnsupportedOperationForm(
            unsupported,
            normalizedPath,
            `exported destructured binding ${declaration.name.getText(sourceFile)} has no complete runtime export resolution`,
          );
          continue;
        }

        if (declaration.initializer === undefined) {
          addUnsupportedOperationForm(
            unsupported,
            normalizedPath,
            `exported binding ${declaration.name.text} has no initializer that proves its value is non-callable`,
          );
          continue;
        }

        const operation = declaration.name.text;
        const initializer = unwrapExpression(declaration.initializer);
        if (HTTP_ROUTE_OPERATIONS.has(operation) && normalizedPath.startsWith("src/app/api/")) {
          addOperation(discovered, normalizedPath, operation, "exported_function");
        }
        recordExportedValue(
          normalizedPath,
          operation,
          initializer,
          bindings,
          discovered,
          unsupported,
        );
      }
    }

    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        recordExportedValue(
          normalizedPath,
          "default",
          statement.expression,
          bindings,
          discovered,
          unsupported,
        );
      } else {
        recordExportedValue(
          normalizedPath,
          "default",
          statement.expression,
          bindings,
          discovered,
          unsupported,
        );
      }
    }

    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (statement.exportClause === undefined) {
        const moduleSpecifier = statement.moduleSpecifier;
        if (
          moduleSpecifier !== undefined &&
          ts.isStringLiteral(moduleSpecifier) &&
          isReviewedNonCallableReExport(
            normalizedPath,
            moduleSpecifier.text,
            "ExportAllDeclaration",
          )
        ) {
          continue;
        }

        addUnsupportedOperationForm(
          unsupported,
          normalizedPath,
          `wildcard re-export ${moduleSpecifier?.getText(sourceFile) ?? "<missing module>"} is not an exact reviewed non-callable re-export`,
        );
        continue;
      }

      if (ts.isNamespaceExport(statement.exportClause)) {
        addUnsupportedOperationForm(
          unsupported,
          normalizedPath,
          `namespace re-export ${statement.exportClause.name.text} is not an approved runtime export surface`,
        );
        continue;
      }

      if (ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          if (specifier.isTypeOnly) {
            continue;
          }

          const exportedName = specifier.name.text;
          const localName = specifier.propertyName?.text ?? exportedName;
          const resolved = statement.moduleSpecifier
            ? undefined
            : resolveBinding(localName, bindings);

          if (HTTP_ROUTE_OPERATIONS.has(exportedName) && normalizedPath.startsWith("src/app/api/")) {
            addOperation(discovered, normalizedPath, exportedName, "exported_function");
          }

          if (resolved !== undefined) {
            recordResolvedValue(
              normalizedPath,
              exportedName,
              resolved,
              bindings,
              discovered,
              unsupported,
            );
          } else {
            addUnsupportedOperationForm(
              unsupported,
              normalizedPath,
              `exported alias ${exportedName} cannot be resolved to a known AST value`,
            );
          }
        }
      }
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      addUnsupportedOperationForm(
        unsupported,
        normalizedPath,
        `exported import-equals binding ${statement.name.text} is not an approved runtime export surface`,
      );
    }

    if (
      (ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      addUnsupportedOperationForm(
        unsupported,
        normalizedPath,
        `exported ${ts.isEnumDeclaration(statement) ? "enum" : "namespace/module"} ${statement.name.text} requires explicit runtime export review`,
      );
    }
  }

  const visitAssignments = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      discoverCommonJsAssignment(
        normalizedPath,
        node,
        bindings,
        discovered,
        unsupported,
      );
      discoverExportedBindingMutation(
        normalizedPath,
        node,
        exportedBindings,
        bindings,
        discovered,
        unsupported,
      );
    }
    ts.forEachChild(node, visitAssignments);
  };
  sourceFile.forEachChild(visitAssignments);

  const uniqueOperations = new Map<string, DiscoveredTenantOperation>();
  for (const operation of discovered) {
    uniqueOperations.set(
      `${operation.implementationPath}#${operation.operation}`,
      operation,
    );
  }

  const uniqueUnsupported = new Map<string, DiscoveredUnsupportedOperationForm>();
  for (const form of unsupported) {
    uniqueUnsupported.set(
      `${form.implementationPath}#${form.description}`,
      form,
    );
  }

  return {
    operations: [...uniqueOperations.values()].sort((left, right) =>
      `${left.implementationPath}#${left.operation}`.localeCompare(
        `${right.implementationPath}#${right.operation}`,
      ),
    ),
    unsupported: [...uniqueUnsupported.values()].sort((left, right) =>
      `${left.implementationPath}#${left.description}`.localeCompare(
        `${right.implementationPath}#${right.description}`,
      ),
    ),
  };
}

export function discoverOperationsFromSource(
  implementationPath: string,
  sourceText: string,
): DiscoveredTenantOperation[] {
  return analyzeSource(implementationPath, sourceText).operations;
}

export function discoverUnsupportedOperationFormsFromSource(
  implementationPath: string,
  sourceText: string,
): DiscoveredUnsupportedOperationForm[] {
  return analyzeSource(implementationPath, sourceText).unsupported;
}

export function discoverGovernedOperations(
  repositoryRoot: string,
  implementationPaths: readonly string[] = discoverGovernedImplementationPaths(
    repositoryRoot,
  ),
): DiscoveredTenantOperation[] {
  const operations = implementationPaths.flatMap((implementationPath) =>
    discoverOperationsFromSource(
      implementationPath,
      readFileSync(path.join(repositoryRoot, implementationPath), "utf8"),
    ),
  );
  const unique = new Map<string, DiscoveredTenantOperation>();
  for (const operation of operations) {
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

export function discoverGovernedUnsupportedOperationForms(
  repositoryRoot: string,
  implementationPaths: readonly string[] = discoverGovernedImplementationPaths(
    repositoryRoot,
  ),
): DiscoveredUnsupportedOperationForm[] {
  const forms = implementationPaths.flatMap((implementationPath) =>
    discoverUnsupportedOperationFormsFromSource(
      implementationPath,
      readFileSync(path.join(repositoryRoot, implementationPath), "utf8"),
    ),
  );
  const unique = new Map<string, DiscoveredUnsupportedOperationForm>();
  for (const form of forms) {
    unique.set(`${form.implementationPath}#${form.description}`, form);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.implementationPath}#${left.description}`.localeCompare(
      `${right.implementationPath}#${right.description}`,
    ),
  );
}

function discoverSourcePaths(repositoryRoot: string): string[] {
  const discovered: string[] = [];
  const excludedDirectories = new Set([
    ".git",
    ".next",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
  ]);
  collectFilesRecursively(
    repositoryRoot,
    "",
    (relativePath) => hasAllowedSourceExtension(relativePath),
    discovered,
    excludedDirectories,
  );
  return [...new Set(discovered)].sort();
}

type LocalPathAlias = Readonly<{
  pattern: string;
  targets: readonly string[];
  baseUrl: string;
}>;

const DEFAULT_LOCAL_PATH_ALIASES: readonly LocalPathAlias[] = [
  { pattern: "@/*", targets: ["src/*"], baseUrl: "" },
];

function loadLocalPathAliases(repositoryRoot: string): LocalPathAlias[] {
  const configPath = path.join(repositoryRoot, "tsconfig.json");
  if (!existsSync(configPath)) {
    return [...DEFAULT_LOCAL_PATH_ALIASES];
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    return [...DEFAULT_LOCAL_PATH_ALIASES];
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    repositoryRoot,
  );
  const configuredPaths = parsed.options.paths ?? {};
  const baseUrl = parsed.options.baseUrl
    ? normalizeRepositoryPath(path.relative(repositoryRoot, parsed.options.baseUrl))
    : "";
  const aliases: LocalPathAlias[] = Object.entries(configuredPaths).map(
    ([pattern, targets]) => ({
      pattern,
      targets: targets.map((target) => normalizeRepositoryPath(target)),
      baseUrl,
    }),
  );

  for (const defaultAlias of DEFAULT_LOCAL_PATH_ALIASES) {
    if (!aliases.some((alias) => alias.pattern === defaultAlias.pattern)) {
      aliases.push(defaultAlias);
    }
  }
  return aliases;
}

function aliasCandidates(
  specifier: string,
  aliases: readonly LocalPathAlias[],
): string[] {
  const candidates: string[] = [];

  for (const alias of aliases) {
    const wildcardIndex = alias.pattern.indexOf("*");
    let replacement: string | null = null;
    if (wildcardIndex === -1) {
      if (specifier === alias.pattern) {
        replacement = "";
      }
    } else {
      const prefix = alias.pattern.slice(0, wildcardIndex);
      const suffix = alias.pattern.slice(wildcardIndex + 1);
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        replacement = specifier.slice(
          prefix.length,
          specifier.length - suffix.length,
        );
      }
    }

    if (replacement === null) {
      continue;
    }

    for (const target of alias.targets) {
      candidates.push(
        path.posix.normalize(
          path.posix.join(alias.baseUrl, target.replace("*", replacement)),
        ),
      );
    }
  }

  return candidates;
}

function isRepositoryRelativePath(relativePath: string): boolean {
  const normalized = path.posix.normalize(relativePath);
  return (
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !path.posix.isAbsolute(normalized) &&
    !path.win32.isAbsolute(normalized)
  );
}

function sourcePathCandidates(candidate: string): string[] {
  const extension = path.posix.extname(candidate).toLowerCase();
  const candidates = new Set<string>([candidate]);
  const base = GOVERNED_EXTENSION_SET.has(extension)
    ? candidate.slice(0, -extension.length)
    : candidate;
  for (const sourceExtension of GOVERNED_SOURCE_EXTENSIONS) {
    candidates.add(`${base}${sourceExtension}`);
    candidates.add(`${base}/index${sourceExtension}`);
  }
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    candidates.add(`${base}.ts`);
    candidates.add(`${base}.tsx`);
  }
  return [...candidates];
}

function resolveImportSpecifier(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
  aliases: readonly LocalPathAlias[] = DEFAULT_LOCAL_PATH_ALIASES,
): string | null {
  const candidates = specifier.startsWith("./") || specifier.startsWith("../")
    ? [
        path.posix.normalize(
          path.posix.join(path.posix.dirname(fromPath), specifier),
        ),
      ]
    : aliasCandidates(specifier, aliases);

  for (const candidate of candidates) {
    if (!isRepositoryRelativePath(candidate)) {
      continue;
    }
    for (const resolved of sourcePathCandidates(candidate)) {
      const normalized = normalizeRepositoryPath(resolved);
      if (isRepositoryRelativePath(normalized) && knownPaths.has(normalized)) {
        return normalized;
      }
    }
  }
  return null;
}

function collectStaticModuleSpecifiers(
  sourceFile: ts.SourceFile,
): string[] {
  const specifiers: string[] = [];
  const addSpecifier = (expression: ts.Expression | undefined): void => {
    if (expression !== undefined && ts.isStringLiteral(expression)) {
      specifiers.push(expression.text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addSpecifier(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) {
        addSpecifier(node.argument.literal);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(node.arguments[0]);
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        addSpecifier(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...new Set(specifiers)];
}

export function findProductionImportBoundaryViolationsFromSources(
  sourceFiles: readonly SourceFileForImportBoundary[],
  options: Readonly<{ aliases?: readonly LocalPathAlias[] }> = {},
): ProductionImportBoundaryViolation[] {
  const normalizedSourceFiles = sourceFiles.map((sourceFile) => ({
    relativePath: normalizeRepositoryPath(sourceFile.relativePath),
    sourceText: sourceFile.sourceText,
  }));
  const knownPaths = new Set(
    normalizedSourceFiles.map((sourceFile) => sourceFile.relativePath),
  );
  const aliases = options.aliases ?? DEFAULT_LOCAL_PATH_ALIASES;
  const violations: ProductionImportBoundaryViolation[] = [];

  for (const sourceFile of normalizedSourceFiles) {
    if (!isProductionSourcePath(sourceFile.relativePath)) {
      continue;
    }

    const parsed = ts.createSourceFile(
      sourceFile.relativePath,
      sourceFile.sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(sourceFile.relativePath),
    );
    for (const specifier of collectStaticModuleSpecifiers(parsed)) {
      const resolvedPath = resolveImportSpecifier(
        sourceFile.relativePath,
        specifier,
        knownPaths,
        aliases,
      );
      if (
        resolvedPath !== null &&
        isExcludedTestOrSpecPath(resolvedPath)
      ) {
        violations.push({
          fromPath: sourceFile.relativePath,
          specifier,
          resolvedPath,
        });
      }
    }
  }

  const unique = new Map<string, ProductionImportBoundaryViolation>();
  for (const violation of violations) {
    unique.set(
      `${violation.fromPath}#${violation.specifier}#${violation.resolvedPath}`,
      violation,
    );
  }
  return [...unique.values()].sort((left, right) =>
    `${left.fromPath}#${left.specifier}`.localeCompare(
      `${right.fromPath}#${right.specifier}`,
    ),
  );
}

export function findProductionImportBoundaryViolations(
  repositoryRoot: string,
): ProductionImportBoundaryViolation[] {
  const sourceFiles = discoverSourcePaths(repositoryRoot).map((relativePath) => ({
    relativePath,
    sourceText: readFileSync(path.join(repositoryRoot, relativePath), "utf8"),
  }));
  return findProductionImportBoundaryViolationsFromSources(sourceFiles, {
    aliases: loadLocalPathAliases(repositoryRoot),
  });
}
