// triage/resolve.mjs — 承認待ち(triage.status="awaiting")のリアクションをポーリングして判定する。
//   オーナーが ✅ → 対象リポへ dispatch（approved）/ ❌ → rejected / どちらも無ければ据え置き。

import { listReports, updateReport } from "./store.mjs";
import { fetchReactionUserIds } from "./discord.mjs";
import { dispatchApprovedFix } from "./github.mjs";
import { repoOf, ownerId, approvalDecision, APPROVE_EMOJI, REJECT_EMOJI } from "./apps.mjs";

export async function resolve({ dryRun = false } = {}) {
  const owner = ownerId();
  if (!owner) { console.warn("[resolve] DISCORD_OWNER_ID 未設定→承認判定不可"); return { approved: 0, rejected: 0, pending: 0 }; }
  const waiting = await listReports({ status: "awaiting" });
  let approved = 0, rejected = 0, pending = 0;
  for (const { pathname, record } of waiting) {
    const t = record.triage || {};
    if (!t.messageId || !t.channelId) { console.warn(`[resolve] ${record.id}: message未記録→スキップ`); pending++; continue; }
    const approvers = await fetchReactionUserIds(t.messageId, APPROVE_EMOJI, t.channelId);
    const rejecters = await fetchReactionUserIds(t.messageId, REJECT_EMOJI, t.channelId);
    const decision = approvalDecision({ ownerId: owner, approvers, rejecters });
    if (decision === "pending") { pending++; continue; }

    if (decision === "reject") {
      if (!dryRun) { record.triage = { ...t, status: "rejected", resolvedAt: new Date().toISOString() }; await updateReport(pathname, record); }
      console.log(`[resolve] ${record.app}/${record.id} → rejected`);
      rejected++; continue;
    }

    // approve
    const repo = repoOf(record.app);
    if (!repo) { console.warn(`[resolve] ${record.app}: TARGET_REPO 未設定→適用不可`); pending++; continue; }
    const payload = { id: record.id, app: record.app, comment: record.comment, imageUrl: record.imageUrl, summary: t.draft?.summary, fixIntent: t.draft?.fixIntent };
    if (dryRun) { console.log(`[dry] approve → dispatch ${repo}`, payload); approved++; continue; }
    await dispatchApprovedFix(repo, payload);
    record.triage = { ...t, status: "approved", repo, resolvedAt: new Date().toISOString() };
    await updateReport(pathname, record);
    console.log(`[resolve] ${record.app}/${record.id} → approved → dispatch ${repo}`);
    approved++;
  }
  console.log(`[resolve] approved=${approved} rejected=${rejected} pending=${pending} (awaiting=${waiting.length})`);
  return { approved, rejected, pending };
}
