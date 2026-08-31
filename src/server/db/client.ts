import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getServerEnv } from "@/server/config/env";

type Database = ReturnType<typeof drizzle>;

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
    db: drizzle({ client: pool }),
  };
}

const database = globalForDatabase.campushubDatabase ?? createDatabase();

if (getServerEnv().NODE_ENV !== "production") {
  globalForDatabase.campushubDatabase = database;
}

export const db = database.db;
export const pool = database.pool;
