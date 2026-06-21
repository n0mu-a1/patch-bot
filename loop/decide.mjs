// ====================================================================
// loop/decide.mjs — 分類結果 → game-config.js への「提案差分」を組み立てる。
//   ・難易度シグナル → balance を1レバーだけ易化/難化（効果を測りやすく小さく）
//   ・誤字シグナル   → text.* を置換（評価ラベル text.ratings.* は対象外＝人間承認）
//   ・バグ/要望/二極化/低母数の誤字 → 自動パッチせず escalate（人間承認）
// version の +1 は patch.mjs が行う。ここは“値の差分”だけを決める。
// ====================================================================

import {
  MIN_N, JUST_DOMINANT, DECISION_MARGIN, STEP,
  BALANCE_BOUNDS, DIFFICULTY_LEVERS,
  deepGet, flatten, clamp, roundTo, isSmallTextEdit,
} from "./config.mjs";

const pct = (x) => `${Math.round(x * 100)}%`;
const ONE_SIDED_TAIL = 0.1; // 反対票がこれ以下なら「片側偏在」とみなす
const HIGH_DISSATISFACTION = 0.34; // justRate がこれ未満なら不満が高い（negRate>66%）

export function decide({ config, currentStats, signals }) {
  const v = config.version;
  const enoughN = currentStats.n >= MIN_N;
  const hasBugOrRequest = (signals.bugs?.length || 0) > 0 || (signals.requests?.length || 0) > 0;

  // ── 誤字修正の候補（自動ゾーン: text.*。ただし評価ラベルは除外） ──
  const typoCandidates = (signals.typos || [])
    .map((t) => {
      const path = findTextPath(config, t.from);
      return path ? { path, from: t.from, to: t.to, kind: "text" } : null;
    })
    .filter(Boolean);
  const ratingTypos = typoCandidates.filter((d) => d.path.startsWith("text.ratings."));
  const nonRating = typoCandidates.filter((d) => !d.path.startsWith("text.ratings."));
  // 本物の誤字修正は“小さな編集”。from→to が大きく違う「誤字」は、信頼できない
  // プレイヤーコメント由来のNLPを悪用した文言汚染(プロンプトインジェクション)の疑い
  // → 自動適用せず人間承認へ。小さな編集だけ自動、最大2件。
  const smallTypos = nonRating.filter((d) => isSmallTextEdit(d.from, d.to)).slice(0, 2);
  const largeTypos = nonRating.filter((d) => !isSmallTextEdit(d.from, d.to));
  const typoDiff = enoughN ? smallTypos : []; // 母数不足では UI文言の自動書換もしない
  const typoEscalate = ratingTypos.length > 0 || largeTypos.length > 0 || (smallTypos.length > 0 && !enoughN);

  // ── バランス調整（難易度シグナル） ──
  let balanceDiff = [];
  let balanceReason = "";
  let polarized = false;
  if (!enoughN) {
    balanceReason = `母数不足 (N=${currentStats.n} < ${MIN_N})。バランスは様子見。`;
  } else {
    const { hardRate, easyRate, justRate } = currentStats;
    const delta = hardRate - easyRate;
    const oneSidedHard = hardRate >= DECISION_MARGIN && easyRate <= ONE_SIDED_TAIL;
    const oneSidedEasy = easyRate >= DECISION_MARGIN && hardRate <= ONE_SIDED_TAIL;

    if (justRate >= JUST_DOMINANT && !oneSidedHard && !oneSidedEasy) {
      balanceReason = `「ちょうど良い」が ${pct(justRate)} で多数。無変更が正解。`;
    } else if (delta >= DECISION_MARGIN || oneSidedHard) {
      balanceDiff = easeOrHarden(config, "ease");
      balanceReason = `「難しすぎ」優勢 (hard ${pct(hardRate)} / easy ${pct(easyRate)}) → 易化`;
    } else if (-delta >= DECISION_MARGIN || oneSidedEasy) {
      balanceDiff = easeOrHarden(config, "harden");
      balanceReason = `「簡単すぎ」優勢 (easy ${pct(easyRate)} / hard ${pct(hardRate)}) → 難化`;
    } else if (justRate < HIGH_DISSATISFACTION) {
      polarized = true; // 不満は高いが難/易が拮抗 → 方向が決められない
      balanceReason = `不満が高い (ちょうど良い ${pct(justRate)}) が難/易が拮抗。二極化のため人間判断へ。`;
    } else {
      balanceReason = `難易度の偏りが小さい (|hard-easy| ${pct(Math.abs(delta))} < ${pct(DECISION_MARGIN)})。無変更。`;
    }
    const wantedChange = delta >= DECISION_MARGIN || -delta >= DECISION_MARGIN || oneSidedHard || oneSidedEasy;
    if (balanceDiff.length === 0 && wantedChange) {
      balanceReason += "（全レバーが安全域の端で調整不可 → 無変更）";
    }
  }

  const diff = [...balanceDiff, ...typoDiff];

  // ── 人間承認へ落とす条件 ──
  if (hasBugOrRequest || polarized || typoEscalate) {
    const reasonBits = [];
    if (hasBugOrRequest) reasonBits.push("バグ報告/機能要望（ロジック・新機能領域）");
    if (polarized) reasonBits.push("難易度の二極化");
    if (ratingTypos.length) reasonBits.push("評価ラベルの文言修正提案（ループ入力定義の保護）");
    if (largeTypos.length) reasonBits.push("大きすぎる文言改変提案（汚染/インジェクションの疑い）");
    if (smallTypos.length && !enoughN) reasonBits.push("母数不足での文言修正提案");
    return {
      action: "escalate",
      reason: reasonBits.join(" / "),
      issueTitle: `[reflex-lab] 人間承認が必要なフィードバック (config v${v})`,
      issueBody: buildIssueBody({ v, currentStats, signals, suggestedDiff: diff, balanceReason, ratingTypos: [...ratingTypos, ...largeTypos] }),
    };
  }

  if (diff.length === 0) {
    return { action: "noop", reason: balanceReason || "変更すべきシグナルなし" };
  }

  return {
    action: "patch",
    fromVersion: v,
    toVersion: v + 1,
    diff,
    summary: summarize(diff, balanceReason),
    stats: currentStats,
  };
}

// ── helpers ──────────────────────────────────────────────────────

function easeOrHarden(config, mode) {
  for (const lever of DIFFICULTY_LEVERS) {
    const key = lever.path.split(".").pop();
    const bounds = BALANCE_BOUNDS[key];
    const from = deepGet(config, lever.path);
    if (typeof from !== "number" || !bounds) continue;
    const sign = mode === "ease" ? lever.easeSign : -lever.easeSign;
    const raw = from * (1 + sign * STEP);
    const to = clamp(roundTo(raw, lever.roundTo), bounds);
    if (to !== from) return [{ path: lever.path, from, to, kind: "balance" }];
  }
  return [];
}

function findTextPath(config, value) {
  for (const [k, v] of Object.entries(flatten(config))) {
    if (k.startsWith("text.") && v === value) return k;
  }
  return null;
}

// プレイヤーコメント由来の文字列を GitHub issue 本文に埋め込む前に無害化する。
// 改行を潰して複数行インジェクションを防ぎ、行頭の Markdown 構造文字をエスケープする
// （見出し/水平線/表/引用に化けて人間レビュアを誤誘導するのを防ぐ）。
function sanitizeMd(s) {
  return String(s)
    .replace(/\r?\n/g, " ")
    .replace(/^[#>|`\-*_~+=.]/u, "\\$&")
    .trim();
}

function summarize(diff, balanceReason) {
  const parts = diff.map((d) => (d.kind === "balance" ? `${d.path} ${d.from}→${d.to}` : `${d.path} 文言修正`));
  const head = balanceReason && diff.some((d) => d.kind === "balance") ? balanceReason : "自動調整";
  return `${head} / ${parts.join(", ")}`;
}

function buildIssueBody({ v, currentStats, signals, suggestedDiff, balanceReason, ratingTypos }) {
  const lines = [
    `config **v${v}** のフィードバックに、自動ゾーン外の声が含まれています。`,
    "",
    `## 集計 (N=${currentStats.n})`,
    `- 難しすぎ: ${pct(currentStats.hardRate)} / ちょうど良い: ${pct(currentStats.justRate)} / 簡単すぎ: ${pct(currentStats.easyRate)}`,
    `- ${balanceReason}`,
    "",
  ];
  if (signals.bugs?.length) lines.push("## バグ報告", ...signals.bugs.map((b) => `- ${sanitizeMd(b)}`), "");
  if (signals.requests?.length) lines.push("## 要望", ...signals.requests.map((r) => `- ${sanitizeMd(r)}`), "");
  if (ratingTypos?.length) lines.push("## 評価ラベルの修正提案（自動適用しない）", ...ratingTypos.map((d) => `- \`${d.path}\`「${sanitizeMd(d.from)}」→「${sanitizeMd(d.to)}」`), "");
  if (suggestedDiff?.length) {
    lines.push("## 参考: gate内で自動化可能だった調整案", ...suggestedDiff.map((d) => `- \`${d.path}\` ${d.kind === "balance" ? `${d.from}→${d.to}` : "文言修正"}`), "");
  }
  if (signals.summary) lines.push(`> ${sanitizeMd(signals.summary)}`);
  lines.push("", "---", "_このissueは reflex-lab 自律ループが自動起票。承認するなら game-config.js を手で調整してください。_");
  return lines.join("\n");
}
