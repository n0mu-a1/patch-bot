// ====================================================================
// loop/classify.mjs — ②分類Agent。
//   ・決定論パート: rating を version 別に集計（母数・難易度傾向・ネガ率）
//   ・NLPパート:    自由記述コメントから「誤字 / バグ / 要望」を抽出
//                   （ANTHROPIC_API_KEY が無ければスキップし集計だけで動く）
// ====================================================================

import { flatten } from "./config.mjs";

const RATINGS = ["easy", "just", "hard"];
const CLASSIFY_MODEL = process.env.REFLEX_CLASSIFY_MODEL || "claude-haiku-4-5-20251001";

// version 別の集計。negRate = (easy+hard)/n = 1 - justRate（“ちょうど良くない”率）。
export function aggregate(entries) {
  const byVer = new Map();
  for (const e of entries) {
    if (!RATINGS.includes(e.rating)) continue;
    const v = e.configVersion;
    if (!byVer.has(v)) byVer.set(v, { version: v, n: 0, easy: 0, just: 0, hard: 0 });
    const s = byVer.get(v);
    s.n++; s[e.rating]++;
  }
  for (const s of byVer.values()) finalizeRates(s);
  return byVer;
}

function finalizeRates(s) {
  const n = s.n || 1;
  s.easyRate = s.easy / n;
  s.justRate = s.just / n;
  s.hardRate = s.hard / n;
  s.negRate = (s.easy + s.hard) / n;
  return s;
}

export function statsForVersion(entries, version) {
  const s = aggregate(entries).get(version);
  return s || finalizeRates({ version, n: 0, easy: 0, just: 0, hard: 0 });
}

// 現バージョンのコメントから誤字/バグ/要望を抽出。
// 戻り値: { typos:[{from,to}], bugs:[string], requests:[string], summary:string }
export async function extractCommentSignals({ entries, version, config, apiKey = process.env.ANTHROPIC_API_KEY }) {
  const empty = { typos: [], bugs: [], requests: [], summary: "" };
  const comments = entries
    .filter((e) => e.configVersion === version && e.comment && e.comment.trim())
    .map((e) => e.comment.trim())
    .slice(0, 120);
  if (!apiKey || comments.length === 0) return empty;

  // 既存のテキスト値一覧（誤字修正は“既存の文言”に対してのみ許可する）
  const textValues = new Set(
    Object.entries(flatten(config))
      .filter(([k, v]) => k.startsWith("text.") && typeof v === "string")
      .map(([, v]) => v),
  );

  let raw;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 1024,
      system:
        "あなたはゲームのプレイヤーフィードバック分類器です。日本語コメント配列を読み、" +
        "JSONのみを返してください。キーは typos(誤字脱字・言い回しの明確な修正), " +
        "bugs(不具合・操作不能・スコア異常などの報告), requests(新機能・仕様変更の要望), " +
        "summary(全体傾向の一文)。typos の各要素は {from, to} で、from は『既存文言一覧』に" +
        "完全一致する文字列のみ。確信が持てないものは含めない。該当なしは空配列。",
      messages: [
        {
          role: "user",
          content:
            "既存文言一覧:\n" + JSON.stringify([...textValues], null, 0) +
            "\n\nコメント:\n" + JSON.stringify(comments, null, 0) +
            '\n\nJSONのみ返す。形式: {"typos":[{"from":"","to":""}],"bugs":[],"requests":[],"summary":""}',
        },
      ],
    });
    raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (err) {
    console.error("[classify] NLP skipped:", err?.message || err);
    return empty;
  }

  const parsed = parseJsonLoose(raw);
  if (!parsed) return empty;

  // ── 検証: 誤字は“既存文言への置換”だけ採用、バグ/要望は文字列のみ ──
  const typos = (Array.isArray(parsed.typos) ? parsed.typos : [])
    .filter((t) => t && typeof t.from === "string" && typeof t.to === "string")
    .filter((t) => textValues.has(t.from) && t.to.trim() && t.from !== t.to)
    .map((t) => ({ from: t.from, to: t.to.trim().slice(0, 80) }))
    .slice(0, 5);
  const bugs = strList(parsed.bugs);
  const requests = strList(parsed.requests);
  const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 200) : "";
  return { typos, bugs, requests, summary };
}

function strList(v) {
  return (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 160)).slice(0, 10);
}

function parseJsonLoose(text) {
  if (!text) return null;
  const fenced = text.replace(/```json\s*|\s*```/g, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}
