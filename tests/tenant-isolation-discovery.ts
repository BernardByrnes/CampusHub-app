import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";

import {
  REVIEWED_NON_CALLABLE_REEXPORT_CONTRACTS,
  REVIEWED_NON_CALLABLE_EXPORT_CONTRACTS,
  REVIEWED_NON_OPERATIONAL_MODULE_INITIALIZER_CONTRACTS,
  REVIEWED_NON_OPERATIONAL_MODULE_STATEMENT_CONTRACTS,
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
  kind?: "unresolved_loader";
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
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      statement.name !== undefined
    ) {
      addExportedBindingName(
        bindings,
        statement.name.text,
        statement.name.text,
      );
      continue;
    }

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

function modifierNames(node: ts.Node): string[] {
  if (!ts.canHaveModifiers(node)) {
    return [];
  }

  return (ts.getModifiers(node) ?? []).map((modifier) => {
    switch (modifier.kind) {
      case ts.SyntaxKind.PublicKeyword:
        return "public";
      case ts.SyntaxKind.PrivateKeyword:
        return "private";
      case ts.SyntaxKind.ProtectedKeyword:
        return "protected";
      case ts.SyntaxKind.ReadonlyKeyword:
        return "readonly";
      case ts.SyntaxKind.StaticKeyword:
        return "static";
      case ts.SyntaxKind.AbstractKeyword:
        return "abstract";
      case ts.SyntaxKind.AsyncKeyword:
        return "async";
      case ts.SyntaxKind.OverrideKeyword:
        return "override";
      case ts.SyntaxKind.DeclareKeyword:
        return "declare";
      case ts.SyntaxKind.ExportKeyword:
        return "export";
      case ts.SyntaxKind.DefaultKeyword:
        return "default";
      case ts.SyntaxKind.AccessorKeyword:
        return "accessor";
      case ts.SyntaxKind.ConstKeyword:
        return "const";
      case ts.SyntaxKind.InKeyword:
        return "in";
      default:
        return `unknown:${modifier.kind}`;
    }
  });
}

function hasRuntimeDecorators(node: ts.Node): boolean {
  return (
    ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0
  );
}

function hasComputedClassMemberName(member: ts.ClassElement): boolean {
  if (
    ts.isConstructorDeclaration(member) ||
    ts.isClassStaticBlockDeclaration(member) ||
    member.name === undefined
  ) {
    return false;
  }

  return !(
    ts.isIdentifier(member.name) ||
    ts.isStringLiteral(member.name) ||
    ts.isNumericLiteral(member.name) ||
    ts.isPrivateIdentifier(member.name)
  );
}

function hasUnsafeRuntimeClassInitialization(
  classDeclaration: ts.ClassDeclaration | ts.ClassExpression,
): boolean {
  if (hasRuntimeDecorators(classDeclaration)) {
    return true;
  }

  if (
    classDeclaration.heritageClauses?.some(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )
  ) {
    return true;
  }

  return classDeclaration.members.some((member) => {
    if (
      hasRuntimeDecorators(member) ||
      hasComputedClassMemberName(member) ||
      ts.isClassStaticBlockDeclaration(member) ||
      ts.isPropertyDeclaration(member)
    ) {
      return true;
    }

    if (ts.isConstructorDeclaration(member)) {
      return (
        hasRuntimeDecorators(member) ||
        member.parameters.some(hasRuntimeDecorators)
      );
    }

    return false;
  });
}

function sameStringArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function isReviewedNonOperationalConstructor(
  implementationPath: string,
  classDeclaration: ts.ClassDeclaration | ts.ClassExpression,
  classIdentity: string,
  constructor: ts.ConstructorDeclaration | undefined,
  sourceFile: ts.SourceFile,
): boolean {
  if (constructor === undefined || constructor.body === undefined) {
    return false;
  }

  if (constructor.body.statements.length !== 0) {
    return false;
  }

  if (
    hasUnsafeRuntimeClassInitialization(classDeclaration) ||
    constructor.parameters.some(hasRuntimeDecorators)
  ) {
    return false;
  }

  const contract = REVIEWED_NON_OPERATIONAL_CONSTRUCTOR_CONTRACTS.find(
    (candidate) =>
      candidate.implementationPath === implementationPath &&
      candidate.classIdentity === classIdentity,
  );
  if (contract === undefined) {
    return false;
  }

  if (
    !sameStringArray(modifierNames(constructor), contract.constructorModifiers) ||
    constructor.parameters.length !== contract.parameterCount
  ) {
    return false;
  }

  return constructor.parameters.every((parameter, index) => {
    if (
      !ts.isIdentifier(parameter.name) ||
      parameter.dotDotDotToken !== undefined ||
      modifierNames(parameter).length !==
        contract.parameterPropertyModifiers[index]?.length
    ) {
      return false;
    }

    if (
      parameter.name.text !== contract.parameterNames[index] ||
      parameter.type?.getText(sourceFile).trim() !==
        contract.parameterTypeTexts[index] ||
      !sameStringArray(
        modifierNames(parameter),
        contract.parameterPropertyModifiers[index] ?? [],
      )
    ) {
      return false;
    }

    const expectedDefault = contract.defaultInitializerIdentifiers[index];
    if (expectedDefault === null) {
      return parameter.initializer === undefined;
    }

    return (
      parameter.initializer !== undefined &&
      ts.isIdentifier(parameter.initializer) &&
      parameter.initializer.text === expectedDefault
    );
  });
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

function isFunctionValue(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped);
}

function isExactCallChainStep(
  expression: ts.Expression,
  memberName: string,
): { receiver: ts.Expression; arguments: readonly ts.Expression[] } | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped)) {
    return null;
  }

  const callee = unwrapExpression(unwrapped.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== memberName) {
    return null;
  }

  return {
    receiver: callee.expression,
    arguments: unwrapped.arguments,
  };
}

function isIdentifierExpression(
  expression: ts.Expression,
  expectedName: string,
): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isIdentifier(unwrapped) && unwrapped.text === expectedName;
}

function isReviewedPostgresConnectionStringInitializer(
  expression: ts.Expression,
): boolean {
  const refine = isExactCallChainStep(expression, "refine");
  if (
    refine === null ||
    refine.arguments.length !== 2 ||
    !isFunctionValue(refine.arguments[0]) ||
    staticStringValue(refine.arguments[1]) !==
      "DATABASE_URL must be a valid PostgreSQL connection URL"
  ) {
    return false;
  }

  const min = isExactCallChainStep(refine.receiver, "min");
  if (
    min === null ||
    min.arguments.length !== 2 ||
    !ts.isNumericLiteral(unwrapExpression(min.arguments[0])) ||
    unwrapExpression(min.arguments[0]).getText() !== "1" ||
    staticStringValue(min.arguments[1]) !== "DATABASE_URL is required"
  ) {
    return false;
  }

  const trim = isExactCallChainStep(min.receiver, "trim");
  if (trim === null || trim.arguments.length !== 0) {
    return false;
  }

  const string = isExactCallChainStep(trim.receiver, "string");
  return (
    string !== null &&
    string.arguments.length === 0 &&
    isIdentifierExpression(string.receiver, "z")
  );
}

function isReviewedDatabaseInitializer(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(unwrapped) ||
    unwrapped.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
  ) {
    return false;
  }

  const left = unwrapExpression(unwrapped.left);
  if (
    !ts.isPropertyAccessExpression(left) ||
    !isIdentifierExpression(left.expression, "globalForDatabase") ||
    left.name.text !== "campushubDatabase"
  ) {
    return false;
  }

  const right = unwrapExpression(unwrapped.right);
  return (
    ts.isCallExpression(right) &&
    right.arguments.length === 0 &&
    isIdentifierExpression(right.expression, "createDatabase")
  );
}

function isReviewedNonOperationalModuleInitializer(
  implementationPath: string,
  bindingName: string,
  initializer: ts.Expression,
): boolean {
  const contract = REVIEWED_NON_OPERATIONAL_MODULE_INITIALIZER_CONTRACTS.find(
    (candidate) =>
      candidate.implementationPath === implementationPath &&
      candidate.bindingName === bindingName,
  );
  if (contract === undefined) {
    return false;
  }

  switch (contract.initializerShape) {
    case "postgres_connection_string_schema":
      return isReviewedPostgresConnectionStringInitializer(initializer);
    case "database_cache_or_create":
      return isReviewedDatabaseInitializer(initializer);
    default:
      return false;
  }
}

function isReviewedNonOperationalModuleStatement(
  implementationPath: string,
  statement: ts.Statement,
): boolean {
  const contract = REVIEWED_NON_OPERATIONAL_MODULE_STATEMENT_CONTRACTS.find(
    (candidate) => candidate.implementationPath === implementationPath,
  );
  if (
    contract === undefined ||
    contract.statementShape !== "development_database_cache_assignment" ||
    !ts.isIfStatement(statement) ||
    statement.elseStatement !== undefined
  ) {
    return false;
  }

  const condition = unwrapExpression(statement.expression);
  if (
    !ts.isBinaryExpression(condition) ||
    condition.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return false;
  }

  const environmentProperty = unwrapExpression(condition.left);
  if (
    !ts.isPropertyAccessExpression(environmentProperty) ||
    environmentProperty.name.text !== "NODE_ENV"
  ) {
    return false;
  }

  const environmentCall = unwrapExpression(environmentProperty.expression);
  if (
    !ts.isCallExpression(environmentCall) ||
    environmentCall.arguments.length !== 0 ||
    !isIdentifierExpression(environmentCall.expression, "getServerEnv") ||
    staticStringValue(condition.right) !== "production"
  ) {
    return false;
  }

  if (
    !ts.isBlock(statement.thenStatement) ||
    statement.thenStatement.statements.length !== 1
  ) {
    return false;
  }

  const bodyStatement = statement.thenStatement.statements[0];
  if (!ts.isExpressionStatement(bodyStatement)) {
    return false;
  }

  const assignment = unwrapExpression(bodyStatement.expression);
  if (
    !ts.isBinaryExpression(assignment) ||
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return false;
  }

  const cacheProperty = unwrapExpression(assignment.left);
  return (
    ts.isPropertyAccessExpression(cacheProperty) &&
    isIdentifierExpression(cacheProperty.expression, "globalForDatabase") &&
    cacheProperty.name.text === "campushubDatabase" &&
    isIdentifierExpression(assignment.right, "database")
  );
}

function isEagerlyInertInitializer(
  expression: ts.Expression,
  visited = new Set<ts.Node>(),
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (visited.has(unwrapped)) {
    return false;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(unwrapped);

  if (
    ts.isLiteralExpression(unwrapped) ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
    ts.isIdentifier(unwrapped)
  ) {
    return true;
  }

  if (isFunctionValue(unwrapped)) {
    return true;
  }

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.every(
      (element) =>
        !ts.isSpreadElement(element) &&
        ts.isExpression(element) &&
        isEagerlyInertInitializer(element, nextVisited),
    );
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped.properties.every((property) => {
      if (
        ts.isMethodDeclaration(property) ||
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property)
      ) {
        return propertyNameText(property.name) !== null;
      }
      if (ts.isPropertyAssignment(property)) {
        return (
          propertyNameText(property.name) !== null &&
          isEagerlyInertInitializer(property.initializer, nextVisited)
        );
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return true;
      }
      return false;
    });
  }

  if (ts.isClassExpression(unwrapped)) {
    return !hasUnsafeRuntimeClassInitialization(unwrapped);
  }

  return false;
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

  if (hasRuntimeDecorators(classDeclaration)) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      `class ${classIdentity} has an unreviewed runtime decorator`,
    );
  }

  if (
    classDeclaration.heritageClauses?.some(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )
  ) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      `class ${classIdentity} has an unreviewed executable extends expression`,
    );
  }

  if (constructor !== undefined && hasRuntimeDecorators(constructor)) {
    addUnsupportedOperationForm(
      unsupported,
      implementationPath,
      `class ${classIdentity} constructor has an unreviewed runtime decorator`,
    );
  }

  if (
    includeConstructor &&
    isConstructible &&
    !isReviewedNonOperationalConstructor(
      implementationPath,
      classDeclaration,
      classIdentity,
      constructor,
      classDeclaration.getSourceFile(),
    )
  ) {
    addOperation(
      discovered,
      implementationPath,
      `${classIdentity}.constructor`,
      "class_method",
    );
  }

  for (const [memberIndex, member] of classDeclaration.members.entries()) {
    if (hasRuntimeDecorators(member)) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `class ${classIdentity} member #${memberIndex + 1} has an unreviewed runtime decorator`,
      );
    }

    if (hasComputedClassMemberName(member)) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `class ${classIdentity} has an unresolved computed member name`,
      );
      continue;
    }

    if (ts.isClassStaticBlockDeclaration(member)) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `${includeConstructor ? "exported " : ""}class ${classIdentity} has an executable static initialization block #${memberIndex + 1}`,
      );
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      if (member.parameters.some(hasRuntimeDecorators)) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `class ${classIdentity} constructor parameter has an unreviewed runtime decorator`,
        );
      }
      continue;
    }

    const isNonPublicField =
      (ts.isPropertyDeclaration(member) &&
        (ts.isPrivateIdentifier(member.name) ||
          hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
          hasModifier(member, ts.SyntaxKind.ProtectedKeyword))) ||
      false;

    if (isNonPublicField && ts.isPropertyDeclaration(member)) {
      if (
        member.initializer !== undefined &&
        !isEagerlyInertInitializer(member.initializer)
      ) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `non-public class field ${classIdentity}.${member.name.getText()} has an initializer with unresolved eager execution`,
        );
      }
      continue;
    }

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

function staticStringValue(node: ts.Node | undefined): string | null {
  if (node === undefined) {
    return null;
  }

  const expression = ts.isExpression(node) ? unwrapExpression(node) : node;
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : null;
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
      staticStringValue(unwrapped.argumentExpression) === "exports"
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
    const staticMemberName = staticStringValue(argument);
    if (staticMemberName !== null) {
      return { isExportSurface: true, operation: staticMemberName };
    }
    if (ts.isNumericLiteral(argument)) {
      return { isExportSurface: true, operation: argument.text };
    }
    return { isExportSurface: true, operation: null };
  }

  return { isExportSurface: false, operation: null };
}

function isCommonJsExportObjectReference(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return isModuleExportsExpression(node);
  }

  if (ts.isElementAccessExpression(node)) {
    if (isModuleExportsExpression(node)) {
      return true;
    }

    const base = unwrapExpression(node.expression);
    return (
      ts.isIdentifier(base) &&
      base.text === "module" &&
      staticStringValue(node.argumentExpression) === null
    );
  }

  return ts.isIdentifier(node) && node.text === "exports";
}

function discoverCommonJsExportSurfaceReferences(
  implementationPath: string,
  sourceFile: ts.SourceFile,
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  const recognisedDirectLhsReferences = new Set<ts.Node>();
  const collectRecognisedDirectLhsReferences = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      commonJsExportTarget(node.left).isExportSurface
    ) {
      const collectReference = (lhsNode: ts.Node): void => {
        if (isCommonJsExportObjectReference(lhsNode)) {
          recognisedDirectLhsReferences.add(lhsNode);
        }
        ts.forEachChild(lhsNode, collectReference);
      };
      collectReference(node.left);
    }
    ts.forEachChild(node, collectRecognisedDirectLhsReferences);
  };

  sourceFile.forEachChild(collectRecognisedDirectLhsReferences);

  const visitReference = (node: ts.Node): void => {
    if (
      isCommonJsExportObjectReference(node) &&
      !recognisedDirectLhsReferences.has(node)
    ) {
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        "CommonJS export object reference is not part of a recognised direct export assignment",
      );
    }
    ts.forEachChild(node, visitReference);
  };

  sourceFile.forEachChild(visitReference);
}

function isRuntimeIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) &&
      (parent.name === node || parent.propertyName === node)) ||
    ts.isTypeNode(parent)
  ) {
    return false;
  }

  return true;
}

function containsExportedBindingReference(
  node: ts.Node,
  exportedBindings: ExportedBindingNames,
): string[] {
  const names = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (
      ts.isIdentifier(current) &&
      exportedBindings.has(current.text) &&
      isRuntimeIdentifierReference(current)
    ) {
      names.add(current.text);
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return [...names];
}

function isKnownMutationCall(node: ts.CallExpression): boolean {
  const callee = unwrapExpression(node.expression);
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }

  const base = unwrapExpression(callee.expression);
  if (!ts.isIdentifier(base)) {
    return false;
  }

  return (
    (base.text === "Object" &&
      ["assign", "defineProperty", "defineProperties"].includes(
        callee.name.text,
      )) ||
    (base.text === "Reflect" && callee.name.text === "set")
  );
}

function isReviewedOrStaticallyNonCallableBinding(
  implementationPath: string,
  localName: string,
  exportedBindings: ExportedBindingNames,
  bindings: ReadonlyMap<string, BindingDeclaration>,
): boolean {
  const binding = bindings.get(localName);
  if (
    binding === undefined ||
    ts.isClassDeclaration(binding) ||
    ts.isFunctionDeclaration(binding) ||
    binding.initializer === undefined
  ) {
    return false;
  }

  return (
    exportedBindings.get(localName)?.some((exportName) =>
      isReviewedNonCallableExport(
        implementationPath,
        exportName,
        binding.initializer!,
      ),
    ) ?? false
  );
}

function discoverExportedBindingCallEscapes(
  implementationPath: string,
  sourceFile: ts.SourceFile,
  exportedBindings: ExportedBindingNames,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const escapedNames = new Set<string>();
      const knownMutationCall = isKnownMutationCall(node);
      const callee = unwrapExpression(node.expression);
      const receiver =
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
          ? callee.expression
          : undefined;

      if (receiver !== undefined) {
        const receiverNames = containsExportedBindingReference(
          receiver,
          exportedBindings,
        );
        for (const name of receiverNames) {
          if (
            isReviewedOrStaticallyNonCallableBinding(
              implementationPath,
              name,
              exportedBindings,
              bindings,
            )
          ) {
            continue;
          }
          addUnsupportedOperationForm(
            unsupported,
            implementationPath,
            `exported binding(s) ${name} are used as an unresolved call receiver`,
          );
        }
      }

      for (const argument of node.arguments) {
        for (const name of containsExportedBindingReference(
          argument,
          exportedBindings,
        )) {
          if (
            !knownMutationCall &&
            isReviewedOrStaticallyNonCallableBinding(
              implementationPath,
              name,
              exportedBindings,
              bindings,
            )
          ) {
            continue;
          }
          escapedNames.add(name);
        }
      }

      if (escapedNames.size > 0) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `exported binding(s) ${[...escapedNames].sort().join(", ")} are passed to a call whose mutation effects are not statically proven safe`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  sourceFile.forEachChild(visit);
}

function isDirectRecognisedCommonJsExportAssignment(
  assignment: ts.BinaryExpression,
): boolean {
  const target = commonJsExportTarget(assignment.left);
  return (
    isAssignmentOperator(assignment.operatorToken.kind) &&
    assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    target.isExportSurface &&
    target.operation !== null
  );
}

function isDirectExportedBindingMutation(
  assignment: ts.BinaryExpression,
  exportedBindings: ExportedBindingNames,
): boolean {
  const left = unwrapExpression(assignment.left);
  if (ts.isIdentifier(left)) {
    return exportedBindings.has(left.text);
  }

  const target = exportedMemberTarget(left);
  return target !== null && exportedBindings.has(target.localName);
}

function discoverExportedBindingAliasEscapes(
  implementationPath: string,
  sourceFile: ts.SourceFile,
  exportedBindings: ExportedBindingNames,
  bindings: ReadonlyMap<string, BindingDeclaration>,
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  const isPotentialAliasInitializer = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapExpression(expression);
    const hasAliasShape =
      ts.isIdentifier(unwrapped) ||
      ts.isObjectLiteralExpression(unwrapped) ||
      ts.isArrayLiteralExpression(unwrapped) ||
      ts.isPropertyAccessExpression(unwrapped) ||
      ts.isElementAccessExpression(unwrapped);
    if (!hasAliasShape) {
      return false;
    }

    const names = containsExportedBindingReference(
      unwrapped,
      exportedBindings,
    );
    return names.some(
      (name) =>
        !isReviewedOrStaticallyNonCallableBinding(
          implementationPath,
          name,
          exportedBindings,
          bindings,
        ),
    );
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      isPotentialAliasInitializer(node.initializer)
    ) {
      const names = containsExportedBindingReference(
        node.initializer,
        exportedBindings,
      );
      if (names.length > 0) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `exported binding(s) ${names.sort().join(", ")} lose provenance in a new binding ${node.name.getText()}`,
        );
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind)
    ) {
      const names = containsExportedBindingReference(
        node.right,
        exportedBindings,
      );
      if (
        names.length > 0 &&
        !isDirectRecognisedCommonJsExportAssignment(node) &&
        !isDirectExportedBindingMutation(node, exportedBindings)
      ) {
        addUnsupportedOperationForm(
          unsupported,
          implementationPath,
          `exported binding(s) ${names.sort().join(", ")} lose provenance through an assignment target`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  sourceFile.forEachChild(visit);
}

function isPlainModuleLoadLiteral(expression: ts.Expression): boolean {
  return ts.isLiteralExpression(unwrapExpression(expression));
}

type TopLevelStatementClassification =
  | "safe_declaration"
  | "already_governed"
  | "reviewed_safe_initialization"
  | "unsupported_runtime";

function isAmbientTopLevelDeclaration(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.DeclareKeyword);
}

function isResourceDeclarationList(
  declarationList: ts.VariableDeclarationList,
): boolean {
  return (declarationList.flags & ts.NodeFlags.Using) === ts.NodeFlags.Using;
}

function classifyTopLevelVariableStatement(
  implementationPath: string,
  sourceFile: ts.SourceFile,
  statement: ts.VariableStatement,
): TopLevelStatementClassification {
  if (isResourceDeclarationList(statement.declarationList)) {
    return "unsupported_runtime";
  }

  if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return "already_governed";
  }

  let hasReviewedInitializer = false;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      return "unsupported_runtime";
    }

    if (declaration.initializer === undefined) {
      continue;
    }

    if (
      isReviewedNonOperationalModuleInitializer(
        implementationPath,
        declaration.name.text,
        declaration.initializer,
      )
    ) {
      hasReviewedInitializer = true;
      continue;
    }

    if (!isEagerlyInertInitializer(declaration.initializer)) {
      return "unsupported_runtime";
    }
  }

  return hasReviewedInitializer
    ? "reviewed_safe_initialization"
    : "safe_declaration";
}

function classifyTopLevelStatement(
  implementationPath: string,
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
): TopLevelStatementClassification {
  if (ts.isExpressionStatement(statement)) {
    return isPlainModuleLoadLiteral(statement.expression)
      ? "safe_declaration"
      : "unsupported_runtime";
  }

  if (ts.isVariableStatement(statement)) {
    return classifyTopLevelVariableStatement(
      implementationPath,
      sourceFile,
      statement,
    );
  }

  if (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement)
  ) {
    return "already_governed";
  }

  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return "safe_declaration";
  }

  if (ts.isClassDeclaration(statement)) {
    return "already_governed";
  }

  if (ts.isEnumDeclaration(statement)) {
    if (isAmbientTopLevelDeclaration(statement)) {
      return "safe_declaration";
    }
    return hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ? "already_governed"
      : "unsupported_runtime";
  }

  if (ts.isModuleDeclaration(statement)) {
    if (isAmbientTopLevelDeclaration(statement)) {
      return "safe_declaration";
    }
    return hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ? "already_governed"
      : "unsupported_runtime";
  }

  if (isReviewedNonOperationalModuleStatement(implementationPath, statement)) {
    return "reviewed_safe_initialization";
  }

  if (
    ts.isIfStatement(statement) ||
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement) ||
    ts.isSwitchStatement(statement) ||
    ts.isTryStatement(statement) ||
    ts.isBlock(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isLabeledStatement(statement)
  ) {
    return "unsupported_runtime";
  }

  // A new or currently unrecognized top-level statement must never default to
  // safe: module evaluation is executable unless its safety is proven above.
  return "unsupported_runtime";
}

function discoverModuleLoadExecution(
  implementationPath: string,
  sourceFile: ts.SourceFile,
  unsupported: DiscoveredUnsupportedOperationForm[],
): void {
  for (const [statementIndex, statement] of sourceFile.statements.entries()) {
    if (
      classifyTopLevelStatement(implementationPath, sourceFile, statement) ===
      "unsupported_runtime"
    ) {
      const statementKind = ts.SyntaxKind[statement.kind] ?? "UnknownStatement";
      addUnsupportedOperationForm(
        unsupported,
        implementationPath,
        `top-level statement #${statementIndex + 1} (${statementKind}) has unresolved module-load execution`,
      );
    }
  }
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
  discoverModuleLoadExecution(normalizedPath, sourceFile, unsupported);
  discoverExportedBindingAliasEscapes(
    normalizedPath,
    sourceFile,
    exportedBindings,
    bindings,
    unsupported,
  );
  discoverExportedBindingCallEscapes(
    normalizedPath,
    sourceFile,
    exportedBindings,
    bindings,
    unsupported,
  );
  discoverCommonJsExportSurfaceReferences(
    normalizedPath,
    sourceFile,
    unsupported,
  );

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

type ModuleSpecifierReference = Readonly<{
  specifier: string | null;
  kind:
    | "import"
    | "export"
    | "import-equals"
    | "import-type"
    | "dynamic-import"
    | "require"
    | "module-require";
}>;

function isModuleRequireCall(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = unwrapExpression(unwrapped.expression);
    return (
      ts.isIdentifier(base) &&
      base.text === "module" &&
      unwrapped.name.text === "require"
    );
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    const base = unwrapExpression(unwrapped.expression);
    return (
      ts.isIdentifier(base) &&
      base.text === "module" &&
      staticStringValue(unwrapped.argumentExpression) === "require"
    );
  }

  return false;
}

function isUnknownModuleMemberCall(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  const base = ts.isElementAccessExpression(unwrapped)
    ? unwrapExpression(unwrapped.expression)
    : null;
  return (
    ts.isElementAccessExpression(unwrapped) &&
    base !== null &&
    ts.isIdentifier(base) &&
    base.text === "module" &&
    staticStringValue(unwrapped.argumentExpression) === null
  );
}

/**
 * Keep non-static loader references with a null specifier so they cannot
 * silently pass the production-to-test boundary check.
 */
function collectStaticModuleSpecifiers(
  sourceFile: ts.SourceFile,
): ModuleSpecifierReference[] {
  const references: ModuleSpecifierReference[] = [];
  const addReference = (
    node: ts.Node | undefined,
    kind: ModuleSpecifierReference["kind"],
  ): void => {
    references.push({ specifier: staticStringValue(node), kind });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addReference(node.moduleSpecifier, "import");
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) {
        addReference(node.moduleSpecifier, "export");
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addReference(node.moduleReference.expression, "import-equals");
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) {
        addReference(node.argument.literal, "import-type");
      }
    } else if (ts.isCallExpression(node)) {
      let kind: ModuleSpecifierReference["kind"] | null = null;
      const callee = unwrapExpression(node.expression);
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        kind = "dynamic-import";
      } else if (ts.isIdentifier(callee) && callee.text === "require") {
        kind = "require";
      } else if (
        isModuleRequireCall(callee) ||
        isUnknownModuleMemberCall(callee)
      ) {
        kind = "module-require";
      }

      if (kind !== null) {
        addReference(node.arguments[0], kind);
      }
    }

    ts.forEachChild(node, visit);
  };

  sourceFile.forEachChild(visit);
  return references;
}

function hasRepositoryLocalSpecifierCandidate(
  fromPath: string,
  specifier: string,
  aliases: readonly LocalPathAlias[],
): boolean {
  const candidates = specifier.startsWith("./") || specifier.startsWith("../")
    ? [
        path.posix.normalize(
          path.posix.join(path.posix.dirname(fromPath), specifier),
        ),
      ]
    : aliasCandidates(specifier, aliases);
  return candidates.some((candidate) => {
    const extension = path.posix.extname(candidate).toLowerCase();
    return (
      isRepositoryRelativePath(candidate) &&
      ![".css", ".less", ".sass", ".scss", ".styl"].includes(extension)
    );
  });
}

const UNRESOLVED_LOCAL_LOADER_PATH = "<unresolved local loader>";

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
    for (const reference of collectStaticModuleSpecifiers(parsed)) {
      if (reference.specifier === null) {
        violations.push({
          fromPath: sourceFile.relativePath,
          specifier: `<non-static ${reference.kind} loader argument>`,
          resolvedPath: UNRESOLVED_LOCAL_LOADER_PATH,
          kind: "unresolved_loader",
        });
        continue;
      }

      const specifier = reference.specifier;
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
      } else if (
        resolvedPath === null &&
        hasRepositoryLocalSpecifierCandidate(
          sourceFile.relativePath,
          specifier,
          aliases,
        )
      ) {
        violations.push({
          fromPath: sourceFile.relativePath,
          specifier,
          resolvedPath: UNRESOLVED_LOCAL_LOADER_PATH,
          kind: "unresolved_loader",
        });
      }
    }
  }

  const unique = new Map<string, ProductionImportBoundaryViolation>();
  for (const violation of violations) {
    unique.set(
      `${violation.fromPath}#${violation.specifier}#${violation.resolvedPath}#${violation.kind ?? "boundary"}`,
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
