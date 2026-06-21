// ====================================================================
// loop/classify.test.mjs — 無料の分類経路（heuristic）と provider 選択の単体テスト。
//   ネットワーク不要・キー不要・$0 で完結する（テスト段階の無料運用を担保）。
// ====================================================================

process.env.REFLEX_NLP_PROVIDER = "heuristic"; // この file は完全オフライン・無料経路を検証

import test from "node:test";
import assert from "node:assert/strict";
import { providerChain, extractCommentSignals } from "./classify.mjs";
import { decide } from "./decide.mjs";
import { loadConfig, MIN_N } from "./config.mjs";

const base = loadConfig();
const mkEntries = (comments) =>
  comments.map((comment, i) => ({ configVersion: base.version, rating: "hard", comment, score: 100 + i }));
const mkStats = (n, easy, just, hard) => ({
  version: base.version, n, easy, just, hard,
  easyRate: easy / n, justRate: just / n, hardRate: hard / n, negRate: (easy + hard) / n,
});

// ── provider 選択（無料優先・有料は明示時のみ） ──────────────────
test("providerChain: 既定(キー無)は heuristic のみ＝完全無料", () => {
  assert.deepEqual(providerChain({}), ["heuristic"]);
});
test("providerChain: GROQ_API_KEY 有なら groq→heuristic（無料LLM）", () => {
  assert.deepEqual(providerChain({ GROQ_API_KEY: "x" }), ["groq", "heuristic"]);
});
test("providerChain: 有料 Anthropic は auto では呼ばない（キーがあっても）", () => {
  assert.deepEqual(providerChain({ ANTHROPIC_API_KEY: "x" }), ["heuristic"]);
});
test("providerChain: anthropic は明示時のみ（→失敗時 heuristic）", () => {
  assert.deepEqual(providerChain({ REFLEX_NLP_PROVIDER: "anthropic" }), ["anthropic", "heuristic"]);
});
test("providerChain: off/none は heuristic 固定", () => {
  assert.deepEqual(providerChain({ REFLEX_NLP_PROVIDER: "off" }), ["heuristic"]);
  assert.deepEqual(providerChain({ REFLEX_NLP_PROVIDER: "none" }), ["heuristic"]);
});

// ── heuristic 抽出（無料・LLM無し＝インジェクション面ゼロ） ───────
test("heuristic: コメント無しは provider=none の空シグナル", async () => {
  const s = await extractCommentSignals({ entries: [], version: base.version, config: base });
  assert.equal(s.provider, "none");
  assert.deepEqual(s.bugs, []);
});

test("頑健性: entries が null/undefined でも throw せず空を返す", async () => {
  for (const bad of [null, undefined]) {
    const s = await extractCommentSignals({ entries: bad, version: base.version, config: base });
    assert.equal(s.provider, "none");
    assert.deepEqual(s, { typos: [], bugs: [], requests: [], summary: "", provider: "none" });
  }
});

test("heuristic: バグ報告を拾う / typos は常に空（安全側）", async () => {
  const s = await extractCommentSignals({
    entries: mkEntries(["タップしても反応しない、バグかも", "楽しい！"]),
    version: base.version, config: base,
  });
  assert.equal(s.provider, "heuristic");
  assert.equal(s.bugs.length, 1);
  assert.deepEqual(s.typos, []); // LLM無しでは文言の自動書換を提案しない
});

test("heuristic: 明確な要望を拾う / 通常コメントは拾わない", async () => {
  const s = await extractCommentSignals({
    entries: mkEntries(["ランキング機能つけてほしい", "ちょうど良くて気持ちいい", "音がいい感じ"]),
    version: base.version, config: base,
  });
  assert.equal(s.requests.length, 1, JSON.stringify(s.requests));
  assert.equal(s.bugs.length, 0);
});

// ── decide との結合（無料経路でも安全弁が効く） ──────────────────
test("結合: heuristic がバグを拾うと escalate（人間承認へ）", async () => {
  const s = await extractCommentSignals({
    entries: mkEntries(["スコアがおかしい、バグってる"]),
    version: base.version, config: base,
  });
  const d = decide({ config: base, currentStats: mkStats(20, 1, 3, 16), signals: s });
  assert.equal(d.action, "escalate");
});

test("結合: 無害コメント＋難多数は通常どおり balance を自動 patch", async () => {
  const s = await extractCommentSignals({
    entries: mkEntries(["難しすぎる", "むずい", "速すぎ"]),
    version: base.version, config: base,
  });
  assert.equal(s.bugs.length, 0);
  assert.equal(s.requests.length, 0);
  const d = decide({ config: base, currentStats: mkStats(MIN_N + 12, 1, 3, MIN_N + 8), signals: s });
  assert.equal(d.action, "patch");
  assert.equal(d.diff[0].kind, "balance");
});
