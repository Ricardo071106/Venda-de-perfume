import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const isLocal = databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
  await pool.end();
  console.log("Schema aplicado com sucesso.");
}

main().catch((err) => {
  console.error("Falha ao aplicar schema:", err);
  process.exit(1);
});
