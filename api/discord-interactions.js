// ====================================================================
// api/discord-interactions.js — Discord Interactions 受信口（Node / 常駐不要）
//
// notify が貼った【✅承認】【❌却下】ボタンを押すと Discord がここへ即POSTする。
// オーナー本人なら、承認は対象リポへ repository_dispatch（=PR作成）を即実行し、
// 元メッセージを「承認済み」に書き換える（3秒以内に同期完結）。
//   ↳ これにより cron(最大6h)を待たずに「✅押した瞬間→修正PR」になる。
//
// 署名検証は Ed25519（node:crypto・依存ゼロ）。生ボディが必須なので bodyParser を切る。
//
// 必要な Vercel env:
//   DISCORD_PUBLIC_KEY  … iris アプリの Public Key（署名検証）
//   DISCORD_OWNER_ID    … 承認できる本人の Discord ユーザーID
//   GH_DISPATCH_TOKEN   … 対象リポへ dispatch する PAT（github.mjs が参照）
//   BLOB_READ_WRITE_TOKEN … 報告レコードの読み書き（@vercel/blob が参照）
// ====================================================================

import { createPublicKey, verify as edVerify } from "node:crypto";
import { getReport, updateReport } from "../triage/store.mjs";
import { dispatchApprovedFix } from "../triage/github.mjs";

export const config = { api: { bodyParser: false } };

// raw 32byte ed25519 公開鍵 → SPKI DER → KeyObject（固定プレフィックス）。
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function ed25519Key(hex) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "spki" });
}

async function readRaw(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).send("method not allowed");

  const sig = req.headers["x-signature-ed25519"];
  const ts = req.headers["x-signature-timestamp"];
  const pub = process.env.DISCORD_PUBLIC_KEY;
  const raw = await readRaw(req);
  if (!sig || !ts || !pub || !raw) return res.status(401).send("bad request");

  let ok = false;
  try {
    ok = edVerify(null, Buffer.from(ts + raw), ed25519Key(pub), Buffer.from(sig, "hex"));
  } catch { ok = false; }
  if (!ok) return res.status(401).send("invalid signature");

  const body = JSON.parse(raw);

  // PING（エンドポイント登録時の疎通確認）
  if (body.type === 1) return res.status(200).json({ type: 1 });

  // ボタン押下（MESSAGE_COMPONENT）
  if (body.type === 3) {
    const owner = process.env.DISCORD_OWNER_ID;
    const clicker = body.member?.user?.id || body.user?.id;
    if (owner && clicker !== owner) return ephemeral(res, "承認権限がありません。");

    const customId = body.data?.custom_id || "";
    const parts = customId.split(":"); // ["pb", action, ...pathname]
    if (parts[0] !== "pb") return ephemeral(res, "不明な操作です。");
    const action = parts[1];
    const pathname = parts.slice(2).join(":");
    const orig = body.message?.content || "";

    const rec = await getReport(pathname);
    if (!rec) return ephemeral(res, "報告が見つかりませんでした。");
    const t = rec.triage || {};
    if (t.status === "approved" || t.status === "rejected") {
      return ephemeral(res, `この報告は既に「${t.status}」で処理済みです。`);
    }

    if (action === "reject") {
      rec.triage = { ...t, status: "rejected", resolvedAt: new Date().toISOString() };
      await updateReport(pathname, rec);
      return updateMessage(res, orig, "❌ **却下しました**（修正は行いません）");
    }

    if (action === "approve") {
      const repo = t.repo;
      if (!repo) return ephemeral(res, "対象リポジトリが未記録のため適用できません。");
      const payload = {
        id: rec.id, app: rec.app, comment: rec.comment, imageUrl: rec.imageUrl,
        summary: t.draft?.summary, fixIntent: t.draft?.fixIntent,
      };
      await dispatchApprovedFix(repo, payload);
      rec.triage = { ...t, status: "approved", repo, resolvedAt: new Date().toISOString() };
      await updateReport(pathname, rec);
      return updateMessage(res, orig, `✅ **承認** → \`${repo}\` で修正PRを作成中…`);
    }

    return ephemeral(res, "不明な操作です。");
  }

  return res.status(200).json({ type: 1 });
}

// 元メッセージ本文を残しつつボタンを消し結果行を追記（type 7 = UPDATE_MESSAGE）。
function updateMessage(res, orig, note) {
  return res.status(200).json({ type: 7, data: { content: `${orig}\n\n${note}`, components: [] } });
}
function ephemeral(res, content) {
  return res.status(200).json({ type: 4, data: { flags: 64, content } });
}
