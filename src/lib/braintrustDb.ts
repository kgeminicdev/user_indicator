import { Pool } from "pg";

const globalForPg = globalThis as unknown as {
  braintrustPgPool: Pool | undefined;
};

export const braintrustPool =
  globalForPg.braintrustPgPool ??
  new Pool({
    connectionString: process.env.BRAINTRUST_DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production")
  globalForPg.braintrustPgPool = braintrustPool;
