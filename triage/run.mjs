// triage/run.mjs — 承認型のCLI。
//   node triage/run.mjs notify   … 新規報告を Discord に通知し承認待ちにする
//   node triage/run.mjs resolve  … リアクションを見て承認/拒否を確定し、承認は対象リポへ dispatch
//   node triage/run.mjs both      … notify → resolve（cron 用）
//   --dry-run … Discord/GitHub への書き込みをせずログのみ

import { notify } from "./notify.mjs";
import { resolve } from "./resolve.mjs";

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("--")) || "both";
const dryRun = argv.includes("--dry-run");

try {
  if (cmd === "notify" || cmd === "both") await notify({ dryRun });
  if (cmd === "resolve" || cmd === "both") await resolve({ dryRun });
} catch (err) {
  console.error("[triage] 失敗:", err?.message || err);
  process.exit(1);
}
