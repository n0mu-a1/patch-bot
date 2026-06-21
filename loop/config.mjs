// ====================================================================
// loop/config.mjs — ループ全体で共有する定数・しきい値・config入出力ヘルパ
//
// ★ここの数値が「自律パッチの安全弁の効き具合」を決める。gate と decide が参照。
// ====================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const CONFIG_PATH = resolve(ROOT, "game-config.js");
export const NOTES_PATH = resolve(ROOT, "PATCHNOTES.md");
export const DECISION_PATH = resolve(ROOT, "decision.json");

// ── 判断しきい値（decide が使う） ──
export const MIN_N = 8; // この件数に満たない version は様子見（外れ値を実装しない）
export const JUST_DOMINANT = 0.5; // 「ちょうど良い」がこれ以上なら無変更が正解
export const DECISION_MARGIN = 0.25; // |hardRate - easyRate| がこれ以上で「明確に難/易」
export const STEP = 0.12; // 1サイクルの調整ステップ（12%、安全弁の±25%より十分小さい）

// ── gate のしきい値（安全弁。decide のSTEPより必ず緩く＝広く取る） ──
export const MAX_DELTA = 0.25; // 1回のバランス値変更幅の上限（±25%）
export const MAX_BALANCE_CHANGES = 1; // 1サイクルで動かせる balance リーフ数（累積破壊を防ぐ）
export const REGRESSION_EPS = 0.05; // ネガティブ率がこの幅を超えて悪化したらブロック

// theme は #rrggbb のみ・UI文言は200字まで（gate / verify が共有）
export const THEME_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const TEXT_MAX = 200;

// ── バランス値の絶対安全域（gate と decide のクランプ） ──
export const BALANCE_BOUNDS = {
  roundSeconds: [15, 90],
  targetLifeMs: [400, 3000],
  spawnIntervalMs: [300, 2000],
  targetSizePx: [40, 140],
  hitScore: [10, 1000],
  missPenalty: [0, 500],
  comboBonus: [0, 200],
};

// 難易度シグナルで自動調整してよいレバーと「易化方向の符号」。
// 易化 = この符号方向に動かす（難化はその逆）。優先順に並べる。
// ★ここに無い balance キー（hitScore/missPenalty/comboBonus/roundSeconds=スコア体系）は
//   難易度と無関係なので自動変更を禁止する（gate が DIFFICULTY_LEVER_PATHS で強制）。
export const DIFFICULTY_LEVERS = [
  { path: "balance.targetLifeMs", easeSign: +1, roundTo: 10 }, // 猶予を延ばすと易しい
  { path: "balance.targetSizePx", easeSign: +1, roundTo: 2 }, // 的を大きくすると易しい
  { path: "balance.spawnIntervalMs", easeSign: +1, roundTo: 10 }, // 間隔を空けると易しい
];
export const DIFFICULTY_LEVER_PATHS = new Set(DIFFICULTY_LEVERS.map((l) => l.path));

// game.js が読む契約。verify がこの存在/型を担保する（自動パッチでの破壊を検知）。
export const REQUIRED_SHAPE = {
  version: "number",
  "balance.roundSeconds": "number",
  "balance.targetLifeMs": "number",
  "balance.spawnIntervalMs": "number",
  "balance.targetSizePx": "number",
  "balance.hitScore": "number",
  "balance.missPenalty": "number",
  "balance.comboBonus": "number",
  "text.title": "string",
  "text.tagline": "string",
  "text.startButton": "string",
  "text.retryButton": "string",
  "text.resultPrefix": "string",
  "text.bestPrefix": "string",
  "text.feedbackHeading": "string",
  "text.feedbackPlaceholder": "string",
  "text.feedbackSubmit": "string",
  "text.feedbackThanks": "string",
  "text.ratings.easy": "string",
  "text.ratings.just": "string",
  "text.ratings.hard": "string",
  "theme.accent": "string",
  "theme.accentDim": "string",
  "theme.bg": "string",
};

// ── config 入出力 ──────────────────────────────────────────────

// 純データconfigには現れない“実行可能トークン”の拒否リスト（多層防御）。
// VM評価では副作用が throw しないがブラウザでは害になる注入（defineProperty/getter等）を
// テキスト段階でも弾く。日本語コメント・数値・文言には出ない記号だけを対象にする。
const DANGEROUS_TOKENS = [
  "defineProperty", "Proxy", "Reflect.", "Object.", "=>", "function",
  "`", "${", "eval", "setProperty", "constructor", "fetch", "require(", "import",
];

function assertNoDangerousTokens(text) {
  for (const tok of DANGEROUS_TOKENS) {
    if (text.includes(tok)) throw new Error(`game-config.js に実行可能トークンが混入: ${tok}`);
  }
}

// VM評価で得たオブジェクトを“プレーンなデータ”に作り直す。
// getter/setter・非列挙プロパティ・Symbolキー・関数・配列は throw で拒否する。
// → これにより「検査時と使用時で値が変わる getter(TOCTOU)」「非列挙キーの密輸」を根絶。
function toPlainData(obj, path) {
  if (obj === null) return null;
  const t = typeof obj;
  if (t === "string" || t === "number" || t === "boolean") return obj;
  if (t !== "object") throw new Error(`不正な型(${t}): ${path}`);
  if (Array.isArray(obj)) throw new Error(`配列は不可: ${path}`);
  const out = {};
  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key === "symbol") throw new Error(`Symbolキー不可: ${path}`);
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (desc.get || desc.set) throw new Error(`getter/setter不可: ${path}.${key}`);
    if (!desc.enumerable) throw new Error(`非列挙プロパティ不可: ${path}.${key}`);
    out[key] = toPlainData(desc.value, `${path}.${key}`);
  }
  return out;
}

// game-config.js (`window.GAME_CONFIG = {...}`) を Node で安全に評価して値を得る。
// 構文/実行エラー・注入は throw する＝それ自体がスモークテスト兼サンドボックス検査になる。
export function loadConfigFromText(text) {
  assertNoDangerousTokens(text);
  const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } } };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox, { timeout: 1000, filename: "game-config.js" });
  const raw = sandbox.window.GAME_CONFIG;
  if (!raw || typeof raw !== "object") throw new Error("window.GAME_CONFIG が定義されていない");
  return toPlainData(raw, "GAME_CONFIG"); // getter/非列挙/Symbol/関数/配列を剥がし拒否
}

export function loadConfig(path = CONFIG_PATH) {
  return loadConfigFromText(readFileSync(path, "utf8"));
}

// ── 小ヘルパ ────────────────────────────────────────────────────
export function deepGet(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// オブジェクトの全リーフを "a.b.c" -> value で平坦化（構造比較に使う）。
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export function clamp(v, [lo, hi]) {
  return Math.max(lo, Math.min(hi, v));
}

export function roundTo(v, step) {
  return Math.round(v / step) * step;
}
