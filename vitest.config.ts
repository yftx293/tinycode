import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: process.platform !== "win32",
    include: ["tests/**/*.test.ts"],
  },
});
