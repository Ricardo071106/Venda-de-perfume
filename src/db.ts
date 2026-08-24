import { Pool } from "pg";
import { config } from "./config.js";

// Supabase (e a maioria dos Postgres gerenciados) exige SSL para conexões
// externas; localhost (ex: um Postgres local via Docker) não usa.
const isLocal = config.databaseUrl.includes("localhost") || config.databaseUrl.includes("127.0.0.1");

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

export async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
