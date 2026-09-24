import { fileURLToPath } from "node:url";
import path from "node:path";

import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
      "server-only": path.resolve(
        projectRoot,
        "node_modules/server-only/empty.js",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Integration files share PostgreSQL catalog ACL fixtures; avoid concurrent GRANT/REVOKE updates.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
