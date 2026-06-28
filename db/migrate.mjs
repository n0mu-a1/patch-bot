import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

if (!url) {
  console.error("TURSO_DATABASE_URL is not set");
  process.exit(1);
}

const client = createClient({ url, authToken });

const info = await client.execute("PRAGMA table_info(feedback)");
const columns = new Set(info.rows.map((row) => String(row.name)));

if (!columns.size) {
  console.log("feedback table not found; no migration applied");
  process.exit(0);
}

const applied = [];

if (!columns.has("game")) {
  await client.execute("ALTER TABLE feedback ADD COLUMN game TEXT NOT NULL DEFAULT 'reflex'");
  applied.push("game");
}

if (!columns.has("kana_json")) {
  await client.execute("ALTER TABLE feedback ADD COLUMN kana_json TEXT");
  applied.push("kana_json");
}

if (applied.length) {
  console.log(`feedback migration applied: ${applied.join(", ")}`);
} else {
  console.log("feedback migration already up to date");
}
