import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const serverOnlyModules = [
  "src/server/config/env.ts",
  "src/server/context/request-context.ts",
  "src/server/context/create-request-context-resolver.ts",
  "src/server/db/client.ts",
  "src/server/repositories/membership-repository.ts",
  "src/server/repositories/tenant-repository.ts",
  "src/application/context/resolve-request-context.ts",
  "src/domain/authorization/context-policy.ts",
  "src/domain/authorization/trusted-request-context.ts",
  "src/domain/membership/institutional-email-policy.ts",
] as const;

describe("server-only architecture boundary", () => {
  it("marks sensitive modules with the server-only boundary", () => {
    for (const relativePath of serverOnlyModules) {
      const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
      expect(source).toContain('import "server-only"');
    }
  });
});
