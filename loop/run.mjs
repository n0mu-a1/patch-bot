#!/usr/bin/env node
// ====================================================================
// loop/run.mjs — 自律パッチループのオーケストレーター。
//
//   収集 → 分類 → 判断 → (patch) → 検証 + gate → ノート / 告知
//                          (escalate) → issue 用ペイロード
//                          (noop)     → 何もしない
//
// 出力は decision.json（GHA ワークフローがこれを読んで git/PR/issue を実行）。
//   action と applied(=実際にファイルを書いたか) の両方を後段が見る。
//
//   node loop/run.mjs --dry-run --seed seed-feedback.json   # ローカル検証（既定）
//   node loop/run.mjs --apply                               # CI: 実ファイル更新 + decision.json
// ====================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { CONFIG_PATH, NOTES_PATH, DECISION_PATH, MIN_N, loadConfigFromText } from "./config.mjs";
import { getDb } from "./db.mjs";
import { collect } from "./collect.mjs";
import { aggregate, statsForVersion, extractCommentSignals } from "./classify.mjs";
import { decide } from "./decide.mjs";
import { computePatch } from "./patch.mjs";
import { verifyText, nodeCheck } from "./verify.mjs";
import { gate } from "./gate.mjs";
import { buildNotes, prependNotes } from "./notes.mjs";
import { announce } from "./announce.mjs";

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const log = (...m) => console.log(...m);

function parseArgs(argv) {
  const a = { apply: false, seed: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") a.apply = true;
    else if (argv[i] === "--dry-run") a.apply = false;
    else if (argv[i] === "--seed") a.seed = argv[++i] || "seed-feedback.json";
  }
  return a;
}

// 回帰サーキットブレーカ（patch_log に依存しない／フィードバック履歴のみで判断）。
// 現version(live)が、直近のデータがある旧versionよりネガ率を悪化させていたら止める。
function regressionBaseline(agg, currentVersion) {
  const cur = agg.get(currentVersion);
  if (!cur || cur.n < MIN_N) return { available: false };
  const prevVers = [...agg.keys()].filter((vn) => vn < currentVersion && agg.get(vn).n >= MIN_N);
  if (prevVers.length === 0) return { available: false };
  const prev = agg.get(Math.max(...prevVers));
  return { available: true, currentNegRate: cur.negRate, baselineNegRate: prev.negRate, prevVersion: prev.version };
}

function gateFailIssue(version, diff, reasons, summary) {
  return [
    `自律ループが config v${version} の自動パッチを試みましたが、**安全弁(gate/verify)で停止**しました。`,
    "", `提案: ${summary || "(なし)"}`, "",
    "### 不合格理由", ...reasons.map((r) => `- ${r}`), "",
    "### 提案差分", ...diff.map((d) => `- \`${d.path}\` ${d.kind === "balance" ? `${d.from}→${d.to}` : "文言修正"}`),
    "", "---", "_人間が内容を確認し、必要なら手で game-config.js を調整してください。_",
  ].join("\n");
}

function lineDiffPreview(oldText, newText) {
  const o = oldText.split("\n"), n = newText.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    if (o[i] !== n[i]) {
      if (o[i] !== undefined) out.push(`- ${o[i]}`);
      if (n[i] !== undefined) out.push(`+ ${n[i]}`);
    }
  }
  return out.join("\n") || "(差分なし)";
}

async function recordPatchLog(db, row) {
  if (!db) return false;
  try {
    await db.execute({
      sql: `INSERT INTO patch_log (from_version, to_version, action, auto, summary, diff_json, stats_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [row.from, row.to, row.action, row.auto ? 1 : 0, row.summary || "",
        JSON.stringify(row.diff || []), JSON.stringify(row.stats || {})],
    });
    return true;
  } catch (e) {
    log(`(patch_log 記録スキップ: ${e?.message || e})`);
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.apply ? "apply" : "dry-run";
  const db = args.seed ? null : await getDb();

  const oldText = readFileSync(CONFIG_PATH, "utf8");
  const oldConfig = loadConfigFromText(oldText);
  const version = oldConfig.version;

  const entries = await collect({ seedPath: args.seed, db });
  const agg = aggregate(entries);
  const currentStats = statsForVersion(entries, version);
  const signals = await extractCommentSignals({ entries, version, config: oldConfig });

  log(`\n=== reflex-lab loop (${mode.toUpperCase()}) ===`);
  log(`config v${version} / feedback ${entries.length}件 / 現version N=${currentStats.n} ` +
    `(難 ${pct(currentStats.hardRate)} / 丁度 ${pct(currentStats.justRate)} / 易 ${pct(currentStats.easyRate)})`);
  if (signals.summary) log(`コメント傾向: ${signals.summary}`);

  const decision = decide({ config: oldConfig, currentStats, signals });
  let result;

  if (decision.action === "noop") {
    log(`→ NOOP: ${decision.reason}`);
    result = { action: "noop", applied: false, mode, version, reason: decision.reason };
    await recordPatchLog(db, { from: version, to: version, action: "noop", auto: true, summary: decision.reason, stats: currentStats });
  } else if (decision.action === "escalate") {
    log(`→ ESCALATE: ${decision.reason}`);
    result = { action: "escalate", applied: false, mode, version, reason: decision.reason, issueTitle: decision.issueTitle, issueBody: decision.issueBody };
    await recordPatchLog(db, { from: version, to: version, action: "escalated", auto: false, summary: decision.reason, stats: currentStats });
  } else {
    const { diff, fromVersion, toVersion, summary } = decision;

    let newText, newConfig;
    try {
      newText = computePatch(oldText, diff);
      newConfig = loadConfigFromText(newText);
    } catch (e) {
      log(`→ ESCALATE (patch適用失敗): ${e.message}`);
      result = { action: "escalate", applied: false, mode, version, reason: `patch適用失敗: ${e.message}`,
        issueTitle: `[reflex-lab] 自動パッチ適用に失敗 (v${version})`, issueBody: gateFailIssue(version, diff, [e.message], summary) };
      return finish(result, db);
    }

    const v = verifyText(newText, { expectedVersion: toVersion });
    const regression = regressionBaseline(agg, version);
    const g = gate({ oldConfig, newConfig, changedFiles: ["game-config.js"], regression });

    if (!v.ok || !g.pass) {
      const reasons = [...(v.ok ? [] : v.errors), ...(g.pass ? [] : g.failures)];
      log(`→ ESCALATE: 安全弁で停止`);
      reasons.forEach((r) => log(`   ✗ ${r}`));
      result = { action: "escalate", applied: false, mode, version, reason: "gate/verify 不合格",
        issueTitle: `[reflex-lab] 自動パッチが安全弁で停止 (v${version})`, issueBody: gateFailIssue(version, diff, reasons, summary) };
      await recordPatchLog(db, { from: version, to: version, action: "escalated", auto: false, summary: `gate/verify: ${reasons[0] || ""}`, stats: currentStats });
      return finish(result, db);
    }

    log(`→ PATCH: v${fromVersion} → v${toVersion}`);
    diff.forEach((d) => log(`   • ${d.kind === "balance" ? `${d.path} ${d.from}→${d.to}` : `${d.path} 文言修正`}`));
    const note = buildNotes({ fromVersion, toVersion, diff, summary, stats: currentStats });

    if (!args.apply) {
      log(`--- パッチ後 game-config.js（dry-run・未書込） ---`);
      log(lineDiffPreview(oldText, newText));
      result = { action: "patch", applied: false, mode, fromVersion, toVersion, summary, diff, notesBody: note };
      return finish(result, db);
    }

    // ── 本適用：config 書込み後の失敗は必ず巻き戻して escalate（状態とdecisionを一致させる） ──
    writeFileSync(CONFIG_PATH, newText);
    const nc = nodeCheck(CONFIG_PATH);
    if (!nc.ok) {
      writeFileSync(CONFIG_PATH, oldText);
      log(`→ ESCALATE: node --check 失敗、巻き戻し`);
      result = { action: "escalate", applied: false, mode, version, reason: "node --check 失敗",
        issueTitle: `[reflex-lab] node --check 失敗で停止 (v${version})`, issueBody: "```\n" + nc.error + "\n```" };
      return finish(result, db);
    }
    try {
      writeFileSync(NOTES_PATH, prependNotes(safeRead(NOTES_PATH), note));
    } catch (e) {
      writeFileSync(CONFIG_PATH, oldText); // パッチノート書込失敗→config巻き戻し
      log(`→ ESCALATE: パッチノート書込失敗、巻き戻し: ${e.message}`);
      result = { action: "escalate", applied: false, mode, version, reason: `notes書込失敗: ${e.message}`,
        issueTitle: `[reflex-lab] パッチ後処理で停止 (v${version})`, issueBody: gateFailIssue(version, diff, [e.message], summary) };
      return finish(result, db);
    }
    const a = await announce(note).catch((e) => ({ posted: false, reason: e?.message || "例外" }));
    log(`   告知: ${a.posted ? "投稿済" : `skip(${a.reason})`}`);
    const logged = await recordPatchLog(db, { from: fromVersion, to: toVersion, action: "patched", auto: true, summary, diff, stats: currentStats });

    result = { action: "patch", applied: true, mode, fromVersion, toVersion, summary, diff, notesBody: note, logged };
  }

  return finish(result, db);
}

function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

async function finish(result, db) {
  writeFileSync(DECISION_PATH, JSON.stringify(result, null, 2) + "\n");
  log(`\ndecision.json: action=${result.action} applied=${result.applied}`);
  if (db && typeof db.close === "function") { try { db.close(); } catch {} }
  return result;
}

main().catch((e) => {
  console.error("loop 異常終了:", e);
  // 障害時も decision.json を残す（ワークフローは noop 扱いで赤くしない方針）。
  try { writeFileSync(DECISION_PATH, JSON.stringify({ action: "noop", applied: false, error: String(e?.message || e) }, null, 2) + "\n"); } catch {}
  process.exit(0);
});
