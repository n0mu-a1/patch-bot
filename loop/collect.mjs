// ====================================================================
// loop/collect.mjs — ①収集Agent。蓄積されたフィードバックを取得する。
//   ・本番: Turso の feedback テーブル
//   ・ローカル/ドライラン: seed-feedback.json（またはエクスポートした控え）
// 出力は { ts, configVersion, rating, comment, score } の配列に正規化。
// ====================================================================

import { readFileSync } from "node:fs";

function normalize(row) {
  return {
    ts: row.ts ?? row.created_at ?? "",
    configVersion: Number(row.configVersion ?? row.config_version ?? 1),
    rating: String(row.rating ?? ""),
    comment: String(row.comment ?? ""),
    score: Number(row.score ?? 0),
  };
}

export function collectFromSeed(path) {
  const arr = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(arr)) throw new Error("seed は配列である必要があります");
  return arr.map(normalize);
}

export async function collectFromDb(db, limit = 2000) {
  const res = await db.execute({
    sql: `SELECT ts, config_version, rating, comment, score
          FROM feedback ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map(normalize);
}

export async function collect({ seedPath, db }) {
  if (seedPath) return collectFromSeed(seedPath);
  if (db) return collectFromDb(db);
  return [];
}

// 直近の自動パッチ履歴（効果測定・ロールバック基準・回帰判定に使う）。
export async function loadPatchLog(db, limit = 20) {
  if (!db) return [];
  try {
    const res = await db.execute({
      sql: `SELECT from_version, to_version, action, auto, summary, stats_json, created_at
            FROM patch_log ORDER BY id DESC LIMIT ?`,
      args: [limit],
    });
    return res.rows.map((r) => ({
      fromVersion: Number(r.from_version),
      toVersion: Number(r.to_version),
      action: String(r.action),
      auto: Number(r.auto) === 1,
      summary: String(r.summary || ""),
      stats: safeJson(r.stats_json),
      createdAt: String(r.created_at || ""),
    }));
  } catch {
    return []; // テーブル未作成等は履歴なし扱い
  }
}

function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
