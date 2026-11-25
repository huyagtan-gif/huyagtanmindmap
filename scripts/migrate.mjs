// SQL миграци ажиллуулагч: migrations/*.sql файлуудыг нэрийн дарааллаар, тус бүрийг нэг транзакцид.
// Ашиглах: DATABASE_URL=... node scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL тохируулаагүй байна.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(727001)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await client.query("SELECT name FROM schema_migration")).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    process.stdout.write(`migrate: ${f} ... `);
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(join(dir, f), "utf8"));
      await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [f]);
      await client.query("COMMIT");
      console.log("ok");
    } catch (e) {
      await client.query("ROLLBACK");
      console.log("АЛДАА");
      throw e;
    }
  }
  console.log("migrate: бүгд хэрэгжсэн");
} finally {
  await client.end();
}
