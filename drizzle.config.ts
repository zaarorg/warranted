import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/rules-engine/src/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
});
