import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { DrizzleDB } from "@warranted/rules-engine";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/warranted_test";

const client = postgres(DATABASE_URL, { max: 10 });
export const db: DrizzleDB = drizzle(client);
