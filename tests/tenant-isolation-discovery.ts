import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const CALLABLE_NAME_HINT =
  /(?:service|handler|route|repository|repo|worker|job|controller|resolver|operation|command|usecase|cache|notification|search|media|backup|restore|processor|executor|action|callback|create|read|write|execute|run|handle|fetch|load|list|find|save|update|delete|publish|resolve|parse|process|send|sync|build|make)/i;

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

function looksPotentiallyCallableName(name: string): boolean {
  return CALLABLE_NAME_HINT.test(name);
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
    );
    return;
  }

  const expression = unwrapExpression(resolved);
  if (visitedExpressions.has(expression)) {
    return;
  }
  visitedExpressions.add(expression);

  if (isCallableExpression(expression)) {
    addOperation(discovered, implementationPath, prefix, "exported_function");
    return;
  }

  if (ts.isObjectLiteralExpression(expression)) {
    discoverObjectOperations(
      implementationPath,
      expression,
      prefix,
      bindings,
      discovered,
      unsupported,
      visitedExpressions,
    );
    return;
  }

  if (ts.isClassExpression(expression)) {
    discoverClassOperations(
      implementationPath,
      expression,
      prefix,
      bindings,
      discovered,
      unsupported,
      visitedExpressions,
    );
  }
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
  const unwrapped = unwrapExpression(expression);

  if (ts.isIdentifier(unwrapped)) {
    recordResolvedValue(
      implementationPath,
      prefix,
      resolveBinding(unwrapped.text, bindings),
      bindings,
      discovered,
      unsupported,
      visitedExpressions,
    );
    if (
      !discovered.some(
        (operation) =>
          operation.implementationPath === implementationPath &&
          operation.operation === prefix,
      ) &&
      looksPotentiallyCallableName(prefix)
    ) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `exported ${prefix} binding cannot be resolved to a callable AST form`,
      );
    }
    return;
  }

  if (
    isCallableExpression(unwrapped) ||
    ts.isFunctionExpression(unwrapped)
  ) {
    addOperation(discovered, implementationPath, prefix, "exported_function");
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

  if (ts.isClassExpression(unwrapped)) {
    discoverClassOperations(
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

  if (ts.isCallExpression(unwrapped) && looksPotentiallyCallableName(prefix)) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      `exported ${prefix} factory call has no statically discoverable callable target`,
    );
  }
}

function discoverClassOperations(
  implementationPath: string,
  classDeclaration: ts.ClassDeclaration | ts.ClassExpression,
  classIdentity: string,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
  visitedExpressions = new Set<ts.Node>(),
): void {
  for (const member of classDeclaration.members) {
    if (
      hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
      hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
    ) {
      continue;
    }

    const memberName = propertyNameText(
      "name" in member ? member.name : undefined,
    );
    if (memberName === null) {
      continue;
    }

    if (ts.isMethodDeclaration(member)) {
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

    if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) {
      if (
        ts.isPropertyDeclaration(member) &&
        member.type !== undefined &&
        ts.isFunctionTypeNode(member.type)
      ) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `class field ${classIdentity}.${memberName} has a callable type without a discoverable initializer`,
        );
      }
      continue;
    }

    const operation = `${classIdentity}.${memberName}`;
    const initializer = unwrapExpression(member.initializer);
    if (isCallableExpression(initializer)) {
      addOperation(discovered, implementationPath, operation, "class_method");
      continue;
    }

    if (ts.isIdentifier(initializer)) {
      const resolved = resolveBinding(initializer.text, bindings);
      if (resolved !== undefined) {
        recordResolvedValue(
          implementationPath,
          operation,
          resolved,
          bindings,
          discovered,
          unsupported,
          visitedExpressions,
        );
        continue;
      }
    }

    if (ts.isCallExpression(initializer) && looksPotentiallyCallableName(memberName)) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `class field ${operation} is initialized by an unresolved factory call`,
      );
    }
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
  const unwrapped = unwrapExpression(value);
  if (ts.isIdentifier(unwrapped)) {
    const resolved = resolveBinding(unwrapped.text, bindings);
    if (resolved !== undefined) {
      recordResolvedValue(
        implementationPath,
        prefix,
        resolved,
        bindings,
        discovered,
        unsupported,
        visitedExpressions,
      );
      return;
    }
  }

  if (isCallableExpression(unwrapped)) {
    addOperation(discovered, implementationPath, prefix, "exported_function");
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

  if (ts.isClassExpression(unwrapped)) {
    discoverClassOperations(
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

  if (ts.isCallExpression(unwrapped) && looksPotentiallyCallableName(prefix)) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      `exported object member ${prefix} is initialized by an unresolved factory call`,
    );
  }
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
  visitedExpressions.add(objectLiteral);

  for (const property of objectLiteral.properties) {
    if (ts.isMethodDeclaration(property)) {
      if (property.body === undefined) {
        continue;
      }
      const memberName = propertyNameText(property.name);
      if (memberName !== null) {
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
      if (memberName !== null) {
        recordObjectMemberValue(
          implementationPath,
          `${prefix}.${memberName}`,
          property.initializer,
          bindings,
          discovered,
          unsupported,
          visitedExpressions,
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
        visitedExpressions,
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
            visitedExpressions,
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
          visitedExpressions,
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
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "module" &&
    expression.name.text === "exports"
  );
}

function commonJsExportOperation(
  expression: ts.Expression,
): string | null {
  if (!ts.isPropertyAccessExpression(expression)) {
    return null;
  }
  if (
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "exports"
  ) {
    return expression.name.text;
  }
  if (ts.isPropertyAccessExpression(expression.expression)) {
    return isModuleExportsExpression(expression.expression)
      ? expression.name.text
      : null;
  }
  return null;
}

function discoverCommonJsAssignment(
  implementationPath: string,
  assignment: ts.BinaryExpression,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  discovered: DiscoveredTenantOperation[],
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return;
  }

  const left = unwrapExpression(assignment.left as ts.Expression);
  const operation = isModuleExportsExpression(left)
    ? "default"
    : commonJsExportOperation(left);
  if (operation === null) {
    return;
  }

  recordExportedValue(
    implementationPath,
    operation,
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
        );
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

        const operation = declaration.name.text;
        const initializer = unwrapExpression(declaration.initializer);
        if (HTTP_ROUTE_OPERATIONS.has(operation) && normalizedPath.startsWith("src/app/api/")) {
          addOperation(discovered, normalizedPath, operation, "exported_function");
          continue;
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

    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (!statement.isTypeOnly && ts.isNamedExports(statement.exportClause)) {
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
            continue;
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
          } else if (looksPotentiallyCallableName(exportedName)) {
            addUnsupportedOperationForm(
              unsupported,
              normalizedPath,
              `exported alias ${exportedName} cannot be resolved to a callable AST form`,
            );
          }
        }
      }
    }

    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      discoverCommonJsAssignment(
        normalizedPath,
        statement.expression,
        bindings,
        discovered,
        unsupported,
      );
    }
  }

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
  collectFilesRecursively(
    repositoryRoot,
    "src",
    (relativePath) => hasAllowedSourceExtension(relativePath),
    discovered,
  );
  return [...new Set(discovered)].sort();
}

function resolveImportSpecifier(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  let candidate: string;
  if (specifier.startsWith("@/")) {
    candidate = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    candidate = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromPath), specifier),
    );
  } else {
    return null;
  }

  if (candidate.startsWith("../") || candidate === "..") {
    return null;
  }

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

  for (const resolved of candidates) {
    const normalized = normalizeRepositoryPath(resolved);
    if (knownPaths.has(normalized)) {
      return normalized;
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
): ProductionImportBoundaryViolation[] {
  const normalizedSourceFiles = sourceFiles.map((sourceFile) => ({
    relativePath: normalizeRepositoryPath(sourceFile.relativePath),
    sourceText: sourceFile.sourceText,
  }));
  const knownPaths = new Set(
    normalizedSourceFiles.map((sourceFile) => sourceFile.relativePath),
  );
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
  return findProductionImportBoundaryViolationsFromSources(sourceFiles);
}
