// ====================================================================
// api/discord-interactions.js — Discord Interactions 受信口（Edge / 常駐不要）
//
// notify が貼った【✅承認】【❌却下】ボタンを押すと Discord がここへ即POSTする。
// オーナー本人なら、承認は対象リポへ repository_dispatch（=PR作成）を即実行し、
// 元メッセージを「承認済み」に書き換える（3秒以内に同期完結）。
//   ↳ これにより cron(最大6h)を待たずに「✅押した瞬間→修正PR」になる。
//
// Edge を使う理由: 署名検証は生ボディが必須で、req.text() で確実に取れるため。
//
// 必要な Vercel env:
//   DISCORD_PUBLIC_KEY  … iris アプリの Public Key（署名検証）
//   DISCORD_OWNER_ID    … 承認できる本人の Discord ユーザーID
//   GH_DISPATCH_TOKEN   … 対象リポへ dispatch する PAT（github.mjs が参照）
//   BLOB_READ_WRITE_TOKEN … 報告レコードの読み書き（@vercel/blob が参照）
// ====================================================================

import nacl from "tweetnacl";
import { getReport, updateReport } from "../triage/store.mjs";
import { dispatchApprovedFix } from "../triage/github.mjs";

export const config = { runtime: "edge" };

function hexToBytes(hex) {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// 元メッセージ本文を残しつつボタンを消し、結果行を追記する（type 7 = UPDATE_MESSAGE）。
const updateMessage = (orig, note) =>
  json({ type: 7, data: { content: `${orig}\n\n${note}`, components: [] } });

const ephemeral = (content) => json({ type: 4, data: { flags: 64, content } });

export default async function handler(req) {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  const raw = await req.text();
  const pub = process.env.DISCORD_PUBLIC_KEY;
  if (!sig || !ts || !pub) return new Response("bad request", { status: 401 });

  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      new TextEncoder().encode(ts + raw),
      hexToBytes(sig),
      hexToBytes(pub),
    );
  } catch { ok = false; }
  if (!ok) return new Response("invalid signature", { status: 401 });

  const body = JSON.parse(raw);

  // PING（エンドポイント登録時の疎通確認）
  if (body.type === 1) return json({ type: 1 });

  // ボタン押下（MESSAGE_COMPONENT）
  if (body.type === 3) {
    const owner = process.env.DISCORD_OWNER_ID;
    const clicker = body.member?.user?.id || body.user?.id;
    if (owner && clicker !== owner) return ephemeral("承認権限がありません。");

    const customId = body.data?.custom_id || "";
    const parts = customId.split(":"); // ["pb", action, ...pathname]
    if (parts[0] !== "pb") return ephemeral("不明な操作です。");
    const action = parts[1];
    const pathname = parts.slice(2).join(":");
    const orig = body.message?.content || "";

    const rec = await getReport(pathname);
    if (!rec) return ephemeral("報告が見つかりませんでした。");
    const t = rec.triage || {};
    if (t.status === "approved" || t.status === "rejected") {
      return ephemeral(`この報告は既に「${t.status}」で処理済みです。`);
    }

    if (action === "reject") {
      rec.triage = { ...t, status: "rejected", resolvedAt: new Date().toISOString() };
      await updateReport(pathname, rec);
      return updateMessage(orig, "❌ **却下しました**（修正は行いません）");
    }

    if (action === "approve") {
      const repo = t.repo;
      if (!repo) return ephemeral("対象リポジトリが未記録のため適用できません。");
      const payload = {
        id: rec.id, app: rec.app, comment: rec.comment, imageUrl: rec.imageUrl,
        summary: t.draft?.summary, fixIntent: t.draft?.fixIntent,
      };
      await dispatchApprovedFix(repo, payload);
      rec.triage = { ...t, status: "approved", repo, resolvedAt: new Date().toISOString() };
      await updateReport(pathname, rec);
      return updateMessage(orig, `✅ **承認** → \`${repo}\` で修正PRを作成中…`);
    }

    return ephemeral("不明な操作です。");
  }

  return json({ type: 1 });
}
