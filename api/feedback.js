// ====================================================================
// api/feedback.js — フィードバック収集エンドポイント (Vercel Serverless / Node)
//
// フロント feedback.js から { ts, configVersion, rating, comment, score, game, kana } を
// POST で受け、検証 → Turso(feedback テーブル)へ insert する「収集の自動化」層。
// 収集Agent(loop/collect.mjs)はこのテーブルを読む。
// ====================================================================

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";

let _db = null;
function db() {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  _db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  return _db;
}

const RATINGS = new Set(["easy", "just", "hard"]);
const GAMES = new Set(["reflex", "hiragana"]);
const RATE_WINDOW_SEC = 120; // 同一端末から短時間の連投を抑える窓
const RATE_MAX = 6; // 窓内の許容件数
const KANA_JSON_MAX = 2000;

function clientHash(req) {
  const xff = req.headers["x-forwarded-for"] || "";
  const ip = String(xff).split(",")[0].trim() || "0.0.0.0";
  const ua = String(req.headers["user-agent"] || "");
  const daySalt = new Date().toISOString().slice(0, 10); // 日次ローテで非PII化
  return createHash("sha256").update(`${ip}|${ua}|${daySalt}`).digest("hex").slice(0, 16);
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // 任意: 許可Originを設定していれば軽くチェック（検証段階の既定は無制限）
  const allow = process.env.FEEDBACK_ALLOW_ORIGIN;
  if (allow) {
    const origin = req.headers.origin || "";
    const origins = allow.split(",").map((v) => v.trim()).filter(Boolean);
    if (origin && !origins.includes(origin)) {
      return res.status(403).json({ ok: false, error: "forbidden_origin" });
    }
  }

  const body = await readJson(req);
  if (body === null) return res.status(400).json({ ok: false, error: "invalid_json" });

  // ── 検証 & 正規化 ──
  const rating = String(body.rating || "");
  if (!RATINGS.has(rating)) return res.status(400).json({ ok: false, error: "invalid_rating" });

  const comment = String(body.comment || "").trim().slice(0, 280);
  const score = Math.max(0, Math.min(1_000_000, Math.trunc(Number(body.score) || 0)));
  const configVersion = Math.max(1, Math.trunc(Number(body.configVersion) || 1));
  const ts = typeof body.ts === "string" && body.ts.length <= 40 ? body.ts : new Date().toISOString();
  const requestedGame = String(body.game || "");
  const game = GAMES.has(requestedGame) ? requestedGame : "reflex";
  const kanaJson = game === "hiragana" && body.kana && typeof body.kana === "object" && !Array.isArray(body.kana)
    ? JSON.stringify(body.kana).slice(0, KANA_JSON_MAX)
    : null;
  const uaHash = clientHash(req);

  try {
    const client = db();

    // 軽い連投抑制（同一端末ハッシュ × 直近の窓）
    const recent = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM feedback
            WHERE ua_hash = ? AND created_at >= datetime('now', ?)`,
      args: [uaHash, `-${RATE_WINDOW_SEC} seconds`],
    });
    if (Number(recent.rows[0]?.n || 0) >= RATE_MAX) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    try {
      await client.execute({
        sql: `INSERT INTO feedback (ts, config_version, rating, comment, score, game, kana_json, ua_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [ts, configVersion, rating, comment, score, game, kanaJson, uaHash],
      });
    } catch (e) {
      if (/no such column/i.test(String(e?.message || e))) {
        // 本番DB未マイグレーション時の暫定動作: 旧スキーマへ保存（game/kana は次回マイグレーションで既定 'reflex' に backfill）
        console.warn("[feedback] columns missing; falling back to legacy schema. Run db:migrate.");
        await client.execute({
          sql: `INSERT INTO feedback (ts, config_version, rating, comment, score, ua_hash)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [ts, configVersion, rating, comment, score, uaHash],
        });
      } else {
        throw e;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    // DB一時障害: フロントは localStorage キューに残して次回再送するので 503 を返す。
    console.error("[feedback] insert failed:", err?.message || err);
    return res.status(503).json({ ok: false, error: "store_unavailable" });
  }
}
