import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    coverage: { provider: "v8" },
  },
});
