import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const NODE_SQLITE_VIRTUAL = "\0virtual:node-sqlite";

const nodeSqlitePlugin = {
  name: "node-sqlite-shim",
  enforce: "pre" as const,
  resolveId(id: string) {
    if (id === "node:sqlite" || id === "sqlite") {
      return NODE_SQLITE_VIRTUAL;
    }
  },
  load(id: string) {
    if (id === NODE_SQLITE_VIRTUAL) {
      return `const mod = require("node:sqlite"); export const DatabaseSync = mod.DatabaseSync; export const StatementSync = mod.StatementSync; export default mod;`;
    }
  }
};

export default defineConfig({
  plugins: [nodeSqlitePlugin, tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules"],
    testTimeout: 30000
  }
});
