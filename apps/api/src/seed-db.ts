import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { seed } from "@warranted/rules-engine";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/warranted_test";
const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

await seed(db);
await client.end();
console.log("Seed complete.");
