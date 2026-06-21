// ====================================================================
// loop/db.mjs — Turso(libSQL) クライアント。env が無ければ null を返し、
// seed/ローカル・ドライランでは @libsql/client 未インストールでも動くよう遅延import。
// ====================================================================

let _db;
export async function getDb() {
  if (_db !== undefined) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) { _db = null; return _db; }
  const { createClient } = await import("@libsql/client");
  _db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  return _db;
}
