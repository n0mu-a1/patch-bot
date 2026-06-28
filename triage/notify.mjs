// triage/notify.mjs — 新規報告(triage.status="new")を起草して Discord に投げ、承認待ちにする。

import { listReports, updateReport } from "./store.mjs";
import { draftFix } from "./draft.mjs";
import { postMessage } from "./discord.mjs";
import { channelOf, repoOf, approvalButtons } from "./apps.mjs";

function buildMessage(record, draft) {
  const lines = [
    `🐛 **不具合報告** \`${record.app}\` / id: \`${record.id}\``,
    "",
    `**内容**: ${draft.summary}`,
    `**修正趣旨**: ${draft.fixIntent}`,
  ];
  if (record.comment && record.comment !== draft.summary) lines.push(`**原文**: ${record.comment.slice(0, 280)}`);
  if (record.imageUrl) lines.push(`**画像**: ${record.imageUrl}`);
  const m = record.meta || {};
  const ctx = [m.screen && `画面:${m.screen}`, m.url, m.ua && m.ua.slice(0, 60)].filter(Boolean).join(" / ");
  if (ctx) lines.push(`*${ctx}*`);
  lines.push("", "下の【✅ 承認】で修正を適用 /【❌ 却下】で破棄");
  return lines.join("\n");
}

export async function notify({ dryRun = false } = {}) {
  const news = await listReports({ status: "new" });
  let sent = 0, skipped = 0;
  for (const { pathname, record } of news) {
    const channel = channelOf(record.app);
    if (!channel) { console.warn(`[notify] ${record.app}: チャンネル未設定→スキップ (${record.id})`); skipped++; continue; }
    const repo = repoOf(record.app); // 承認時の dispatch 先を記録（Vercel側はこれを読むだけ）
    const draft = await draftFix(record);
    const content = buildMessage(record, draft);
    if (dryRun) { console.log(`[dry] notify ${record.app}/${record.id}\n${content}\n`); sent++; continue; }
    const messageId = await postMessage(content, channel, approvalButtons(pathname));
    record.triage = { ...record.triage, status: "awaiting", channelId: channel, messageId, draft, repo, notifiedAt: new Date().toISOString() };
    await updateReport(pathname, record);
    sent++;
  }
  console.log(`[notify] sent=${sent} skipped=${skipped} (new=${news.length})`);
  return { sent, skipped };
}
