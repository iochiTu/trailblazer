import { defineConfig } from "vitest/config";
import { testDatabaseEnv } from "../../vitest.shared.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: testDatabaseEnv,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
