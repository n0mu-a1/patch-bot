// ====================================================================
// api/report.js — 承認型修正の入口。画像つき不具合報告の収集エンドポイント (Vercel / Node)
//
// 対象アプリ（hiragana 等）のフロントから
//   { app, comment, image(dataURL|null), meta } を POST で受け、
//   画像を Vercel Blob、メタ+本文を Blob 上の JSON サイドカーに保存する。
//   1 報告 = reports/<app>/<日付>/<id>.(jpg|json) の最大2ファイル。
//   後段（Discord 承認 → 適用）は Blob の reports/ を列挙して読む。
// ====================================================================

import { put } from "@vercel/blob";
import { createHash, randomUUID } from "node:crypto";

const MAX_COMMENT = 500;
const MAX_IMAGE_BYTES = 1_800_000; // デコード後の上限 (~1.8MB)
const APP_RE = /^[a-z0-9-]{1,32}$/; // 対象アプリ識別子（パス安全）

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

// data:image/jpeg;base64,xxxx → { buf, ext } / 不正なら null
function decodeImage(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  let buf;
  try { buf = Buffer.from(m[2], "base64"); } catch { return null; }
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  return { buf, ext, type: `image/${m[1] === "jpg" ? "jpeg" : m[1]}` };
}

// meta は信頼しない素朴オブジェクトだけ通す（型を固定し巨大化を防ぐ）
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  out.screen = str(meta.screen, 16);
  out.mode = str(meta.mode, 16);
  out.score = num(meta.score);
  out.url = str(meta.url, 300);
  out.ua = str(meta.ua, 400);
  out.lang = str(meta.lang, 20);
  out.vw = num(meta.vw); out.vh = num(meta.vh); out.dpr = num(meta.dpr);
  out.ts = str(meta.ts, 40);
  return out;
}

// REPORT_ALLOW_ORIGIN はカンマ区切りの許可オリジン一覧（複数アプリ対応）。未設定なら無制限。
function originAllowed(origin) {
  const allow = process.env.REPORT_ALLOW_ORIGIN;
  if (!allow) return true;
  if (!origin) return true; // 同一オリジン/非ブラウザは Origin 無し
  return allow.split(",").map((s) => s.trim()).filter(Boolean).includes(origin);
}

// 対象アプリは別オリジン（patch-bot とは別ドメイン）なので CORS を返す。
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allow = process.env.REPORT_ALLOW_ORIGIN;
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", allow ? (originAllowed(origin) ? origin : "null") : "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!originAllowed(req.headers.origin || "")) {
    return res.status(403).json({ ok: false, error: "forbidden_origin" });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[report] BLOB_READ_WRITE_TOKEN is not set");
    return res.status(503).json({ ok: false, error: "store_unavailable" });
  }

  const body = await readJson(req);
  if (body === null) return res.status(400).json({ ok: false, error: "invalid_json" });

  const app = String(body.app || "").trim().toLowerCase();
  if (!APP_RE.test(app)) {
    return res.status(400).json({ ok: false, error: "invalid_app" });
  }

  const comment = String(body.comment || "").trim().slice(0, MAX_COMMENT);
  const img = decodeImage(body.image);
  if (!comment && !img) {
    return res.status(400).json({ ok: false, error: "empty_report" });
  }

  const day = new Date().toISOString().slice(0, 10);
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const base = `reports/${app}/${day}/${id}`;
  const uaHash = clientHash(req);

  try {
    let imageUrl = null;
    if (img) {
      const blob = await put(`${base}.${img.ext}`, img.buf, {
        access: "public",
        contentType: img.type,
        addRandomSuffix: false,
      });
      imageUrl = blob.url;
    }

    const record = {
      id,
      app,
      receivedAt: new Date().toISOString(),
      comment,
      imageUrl,
      uaHash,
      meta: sanitizeMeta(body.meta),
      triage: { status: "new" }, // 後段（Discord 承認 → 適用）が更新するプレースホルダ
    };

    await put(`${base}.json`, JSON.stringify(record, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });

    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error("[report] store failed:", err?.message || err);
    return res.status(503).json({ ok: false, error: "store_unavailable" });
  }
}
