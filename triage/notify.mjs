// triage/notify.mjs — 新規報告(triage.status="new")を起草して Discord に投げ、承認待ちにする。

import { listReports, updateReport } from "./store.mjs";
import { draftFix } from "./draft.mjs";
import { postMessage, addReaction } from "./discord.mjs";
import { channelOf, APPROVE_EMOJI, REJECT_EMOJI } from "./apps.mjs";

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
  lines.push("", `${APPROVE_EMOJI} 承認すると修正を適用 / ${REJECT_EMOJI} 拒否`);
  return lines.join("\n");
}

export async function notify({ dryRun = false } = {}) {
  const news = await listReports({ status: "new" });
  let sent = 0, skipped = 0;
  for (const { pathname, record } of news) {
    const channel = channelOf(record.app);
    if (!channel) { console.warn(`[notify] ${record.app}: チャンネル未設定→スキップ (${record.id})`); skipped++; continue; }
    const draft = await draftFix(record);
    const content = buildMessage(record, draft);
    if (dryRun) { console.log(`[dry] notify ${record.app}/${record.id}\n${content}\n`); sent++; continue; }
    const messageId = await postMessage(content, channel);
    await addReaction(messageId, APPROVE_EMOJI, channel);
    await addReaction(messageId, REJECT_EMOJI, channel);
    record.triage = { ...record.triage, status: "awaiting", channelId: channel, messageId, draft, notifiedAt: new Date().toISOString() };
    await updateReport(pathname, record);
    sent++;
  }
  console.log(`[notify] sent=${sent} skipped=${skipped} (new=${news.length})`);
  return { sent, skipped };
}
