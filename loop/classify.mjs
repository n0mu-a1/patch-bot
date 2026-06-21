// ====================================================================
// loop/classify.mjs — ②分類Agent。
//   ・決定論パート: rating を version 別に集計（母数・難易度傾向・ネガ率）
//   ・NLPパート:    自由記述コメントから「誤字 / バグ / 要望」を抽出
//
//   コスト方針（テスト段階は無料で回す）:
//     既定(auto)は「無料のみ」。GROQ_API_KEY があれば Groq 無料枠でLLM分類、
//     無ければキー不要の heuristic(キーワード判定)で動く。どちらも $0。
//     有料の Anthropic は REFLEX_NLP_PROVIDER=anthropic を明示した時だけ呼ぶ。
//     LLM 呼び出しが失敗しても heuristic に自動フォールバックし、止まらない/課金しない。
//
//   provider 選択（環境変数 REFLEX_NLP_PROVIDER で上書き可）:
//     未設定(auto) → GROQ_API_KEY 有: [groq→heuristic] / 無: [heuristic]
//     "groq"       → [groq→heuristic]   （無料・要 GROQ_API_KEY）
//     "anthropic"  → [anthropic→heuristic]（有料・明示時のみ）
//     "heuristic"/"none"/"off" → [heuristic]（完全オフライン・$0）
// ====================================================================

import { flatten, DANGEROUS_TEXT_RE } from "./config.mjs";

const RATINGS = ["easy", "just", "hard"];
const MODEL_ANTHROPIC = process.env.REFLEX_CLASSIFY_MODEL || "claude-haiku-4-5-20251001";
const MODEL_GROQ = process.env.REFLEX_GROQ_MODEL || "llama-3.3-70b-versatile";
const LLM_TIMEOUT_MS = 20000;

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

// どの provider を順に試すか（無料優先・有料は明示時のみ）。
export function providerChain(env = process.env) {
  const explicit = (env.REFLEX_NLP_PROVIDER || "").trim().toLowerCase();
  if (explicit === "anthropic") return ["anthropic", "heuristic"];
  if (explicit === "groq") return ["groq", "heuristic"];
  if (explicit === "heuristic" || explicit === "none" || explicit === "off") return ["heuristic"];
  if (explicit) {
    // 未知の値（タイポ等）は黙ってauto課金/送信経路に落とさず、無料heuristicに固定して警告。
    console.warn(`[classify] 未知の REFLEX_NLP_PROVIDER="${explicit}" → heuristic にフォールバック`);
    return ["heuristic"];
  }
  // auto（既定）: 無料のみ。Groqキーが有ればLLM、無ければheuristic。有料は自動で呼ばない。
  return env.GROQ_API_KEY ? ["groq", "heuristic"] : ["heuristic"];
}

// 現バージョンのコメントから誤字/バグ/要望を抽出。
// 戻り値: { typos:[{from,to}], bugs:[string], requests:[string], summary:string, provider:string }
export async function extractCommentSignals({ entries, version, config }) {
  const empty = { typos: [], bugs: [], requests: [], summary: "", provider: "none" };
  if (!Array.isArray(entries)) return empty; // 契約: 不正入力でも throw せず空を返す
  const comments = entries
    .filter((e) => e.configVersion === version && e.comment && e.comment.trim())
    .map((e) => e.comment.trim())
    .slice(0, 120);
  if (comments.length === 0) return empty;

  // 既存のテキスト値一覧（誤字修正は“既存の文言”に対してのみ許可する）
  const textValues = new Set(
    Object.entries(flatten(config))
      .filter(([k, v]) => k.startsWith("text.") && typeof v === "string")
      .map(([, v]) => v),
  );

  for (const provider of providerChain()) {
    try {
      if (provider === "heuristic") {
        return { ...heuristicSignals(comments), provider: "heuristic" };
      }
      const raw = await runLlm(provider, { comments, textValues });
      const parsed = parseJsonLoose(raw);
      if (!parsed) throw new Error("JSON 解析失敗");
      return { ...validateParsed(parsed, textValues), provider };
    } catch (err) {
      console.error(`[classify] provider=${provider} skip:`, err?.message || err);
      // 次の provider（最終的に heuristic）へフォールバック
    }
  }
  return empty;
}

// ── LLM 呼び出し（provider 別） ───────────────────────────────────

const SYSTEM_PROMPT =
  "あなたはゲームのプレイヤーフィードバック分類器です。日本語コメント配列を読み、" +
  "JSONのみを返してください。キーは typos(誤字脱字・言い回しの明確な修正), " +
  "bugs(不具合・操作不能・スコア異常などの報告), requests(新機能・仕様変更の要望), " +
  "summary(全体傾向の一文)。typos の各要素は {from, to} で、from は『既存文言一覧』に" +
  "完全一致する文字列のみ。確信が持てないものは含めない。該当なしは空配列。";

function buildUserPrompt(textValues, comments) {
  return (
    "既存文言一覧:\n" + JSON.stringify([...textValues], null, 0) +
    "\n\nコメント:\n" + JSON.stringify(comments, null, 0) +
    '\n\nJSONのみ返す。形式: {"typos":[{"from":"","to":""}],"bugs":[],"requests":[],"summary":""}'
  );
}

async function runLlm(provider, { comments, textValues }) {
  const user = buildUserPrompt(textValues, comments);
  if (provider === "groq") return runGroq(SYSTEM_PROMPT, user);
  if (provider === "anthropic") return runAnthropic(SYSTEM_PROMPT, user);
  throw new Error(`未知の provider: ${provider}`);
}

// Groq（OpenAI互換・無料枠）。依存追加なしで fetch のみ。JSON モードで構造化出力。
async function runGroq(system, user) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY 未設定");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL_GROQ,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

// Anthropic（有料・明示時のみ）。SDK は遅延 import（未設定環境を壊さない）。
async function runAnthropic(system, user) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 未設定");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: MODEL_ANTHROPIC,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// ── heuristic（キー不要・$0・LLM無し＝プロンプトインジェクション面ゼロ） ──
//   typos は出さない（LLM無しで“既存文言への安全な置換”は確信できないため空）。
//   バグ/要望は明確な意図語のみ拾い、人間承認(escalate)へ回す。誤検出は escalate 止まりで安全側。
const BUG_PAT = new RegExp(
  "(バグ|ばぐ|不具合|フリーズ|クラッシュ|落ちる|落ちた|固まる|" +
  "反応しな|タップでき(ない|ず|ません)|押せな|動かな|動かん|うごかな|" +
  "表示されな|表示でき(ない|ず)|消えな|止まらな|スコアが?(おかしい|変|バグ)|エラー)",
);
const REQ_PAT = new RegExp(
  "(ほしい|欲しい|してほしい|したい(です|な|！|!)|できたらいい|出来たらいい|" +
  "あったらいい|あればいい|あると(いい|嬉|うれ)|つけてほしい|付けてほしい|" +
  "追加して|実装して|対応してほしい|要望|あってほしい)",
);

function heuristicSignals(comments) {
  const bugs = [];
  const requests = [];
  for (const c of comments) {
    if (BUG_PAT.test(c)) bugs.push(c.slice(0, 160));
    else if (REQ_PAT.test(c)) requests.push(c.slice(0, 160));
  }
  const summary = `コメント${comments.length}件（無料heuristic判定: バグ疑い${bugs.length} / 要望${requests.length}）`;
  return { typos: [], bugs: bugs.slice(0, 10), requests: requests.slice(0, 10), summary };
}

// ── LLM 出力の検証（誤字は“既存文言への置換”のみ採用） ──────────
function validateParsed(parsed, textValues) {
  const typos = (Array.isArray(parsed.typos) ? parsed.typos : [])
    .filter((t) => t && typeof t.from === "string" && typeof t.to === "string")
    .filter((t) => textValues.has(t.from) && t.to.trim() && t.from !== t.to)
    // 不可視/双方向制御文字を含む“誤字修正”は正規でない＝LLM汚染の疑い。早期に捨てる。
    .filter((t) => !DANGEROUS_TEXT_RE.test(t.to))
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
