import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getServerEnv } from "@/server/config/env";
import * as schema from "@/server/db/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

type DatabaseContainer = Readonly<{
  db: Database;
  pool: Pool;
}>;

const globalForDatabase = globalThis as typeof globalThis & {
  campushubDatabase?: DatabaseContainer;
};

function createDatabase(): DatabaseContainer {
  const environment = getServerEnv();
  const pool = new Pool({ connectionString: environment.DATABASE_URL });

  return {
    pool,
    db: drizzle({ client: pool, schema }),
  };
}

const database = globalForDatabase.campushubDatabase ?? createDatabase();

if (getServerEnv().NODE_ENV !== "production") {
  globalForDatabase.campushubDatabase = database;
}

export const db = database.db;
export const pool = database.pool;
export type CampusHubDatabase = typeof db;
