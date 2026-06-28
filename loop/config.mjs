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

// UI文言に混入させてはいけない文字（gate / verify / classify が共有）:
//   C0制御/DEL に加え、双方向制御(RLO等)・ゼロ幅・行/段落分離・単語結合子・BOM。
//   表示偽装(右左反転)や不可視文字の密輸を、見えない=安全に見えるまま通さない。
//   日本語・英数・記号・絵文字は対象外なので正規の文言は弾かない。
export const DANGEROUS_TEXT_RE = new RegExp(
  "[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\ufeff]",
);
export const DANGEROUS_TEXT_RE_G = new RegExp(DANGEROUS_TEXT_RE.source, "g");

// 文言の自動変更は“小さな編集（誤字修正の範囲）”のみ許可する閾値（decide / gate が共有）。
export const TEXT_EDIT_MAX_LEN_DIFF = 6; // 文字数差がこれを超えたら誤字修正ではない
export const TEXT_EDIT_MIN_ALLOWED = 2; // 短文でも最低これだけの編集距離は許す
export const TEXT_EDIT_RATIO = 0.34; // 許容編集距離 = 元長 × この比率（切上げ）

// ── ゲーム別プロファイル ───────────────────────────────────────
const reflexBalanceBounds = {
  roundSeconds: [15, 90],
  targetLifeMs: [400, 3000],
  spawnIntervalMs: [300, 2000],
  targetSizePx: [40, 140],
  hitScore: [10, 1000],
  missPenalty: [0, 500],
  comboBonus: [0, 200],
};

const reflexDifficultyLevers = [
  { path: "balance.targetLifeMs", easeSign: +1, roundTo: 10 }, // 猶予を延ばすと易しい
  { path: "balance.targetSizePx", easeSign: +1, roundTo: 2 }, // 的を大きくすると易しい
  { path: "balance.spawnIntervalMs", easeSign: +1, roundTo: 10 }, // 間隔を空けると易しい
];

const reflexRequiredShape = {
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

const hiraganaBalanceBounds = {
  distractorSimilarity: [0, 1],
  autoAdvanceMs: [600, 3000],
  weakBoost: [1, 3],
  choices: [2, 4],
  questionsPerSession: [5, 20],
  newKanaBoost: [1, 3],
  wrongLockMs: [200, 1500],
  retryHintDelayMs: [600, 3000],
  "rows.a": [0, 1], "rows.ka": [0, 1], "rows.sa": [0, 1], "rows.ta": [0, 1], "rows.na": [0, 1],
  "rows.ha": [0, 1], "rows.ma": [0, 1], "rows.ya": [0, 1], "rows.ra": [0, 1], "rows.wa": [0, 1],
};

const hiraganaDifficultyLevers = [
  { path: "balance.distractorSimilarity", easeSign: -1, roundTo: 0.05 },
  { path: "balance.autoAdvanceMs", easeSign: +1, roundTo: 50 },
  { path: "balance.weakBoost", easeSign: -1, roundTo: 0.1 },
];

const hiraganaRequiredShape = {
  version: "number",
  "balance.distractorSimilarity": "number",
  "balance.autoAdvanceMs": "number",
  "balance.weakBoost": "number",
  "balance.choices": "number",
  "balance.questionsPerSession": "number",
  "balance.newKanaBoost": "number",
  "balance.wrongLockMs": "number",
  "balance.retryHintDelayMs": "number",
  "balance.rows.a": "number",
  "balance.rows.ka": "number",
  "balance.rows.sa": "number",
  "balance.rows.ta": "number",
  "balance.rows.na": "number",
  "balance.rows.ha": "number",
  "balance.rows.ma": "number",
  "balance.rows.ya": "number",
  "balance.rows.ra": "number",
  "balance.rows.wa": "number",
  "text.title": "string",
  "text.startButton": "string",
  "text.replayButton": "string",
  "text.retryButton": "string",
  "text.homeButton": "string",
  "text.resultPrefix": "string",
  "text.feedbackHeading": "string",
  "text.feedbackThanks": "string",
  "text.ratings.easy": "string",
  "text.ratings.just": "string",
  "text.ratings.hard": "string",
  "theme.bg": "string",
  "theme.card": "string",
  "theme.cardText": "string",
  "theme.accent": "string",
  "theme.accentDim": "string",
  "theme.correct": "string",
  "theme.correctHalo": "string",
  "theme.hanamaru": "string",
  "theme.dim": "string",
};

function makeProfile({
  game,
  label,
  gameConfigFile,
  patchnotesFile,
  decisionFile,
  seedFile,
  balanceBounds,
  difficultyLevers,
  requiredShape,
  integerKeys,
  textMax = TEXT_MAX,
  minKanaSeen,
  weakT,
}) {
  return {
    game,
    label,
    GAME_CONFIG_FILE: gameConfigFile,
    PATCHNOTES_FILE: patchnotesFile,
    DECISION_FILE: decisionFile,
    SEED_FILE: seedFile,
    CONFIG_PATH: resolve(ROOT, gameConfigFile),
    NOTES_PATH: resolve(ROOT, patchnotesFile),
    DECISION_PATH: resolve(ROOT, decisionFile),
    BALANCE_BOUNDS: balanceBounds,
    DIFFICULTY_LEVERS: difficultyLevers,
    DIFFICULTY_LEVER_PATHS: new Set(difficultyLevers.map((l) => l.path)),
    REQUIRED_SHAPE: requiredShape,
    INTEGER_KEYS: integerKeys ?? [],
    TEXT_MAX: textMax,
    MIN_KANA_SEEN: minKanaSeen,
    WEAK_T: weakT,
  };
}

export const PROFILES = {
  reflex: makeProfile({
    game: "reflex",
    label: "瞬発ラボ",
    gameConfigFile: "reflex/game-config.js",
    patchnotesFile: "reflex/PATCHNOTES.md",
    decisionFile: "reflex/decision.json",
    seedFile: "reflex/seed-feedback.json",
    balanceBounds: reflexBalanceBounds,
    difficultyLevers: reflexDifficultyLevers,
    requiredShape: reflexRequiredShape,
  }),
  hiragana: makeProfile({
    game: "hiragana",
    label: "ひらがな おとあて",
    gameConfigFile: "hiragana/game-config.js",
    patchnotesFile: "hiragana/PATCHNOTES.md",
    decisionFile: "hiragana/decision.json",
    seedFile: "hiragana/seed-feedback.json",
    balanceBounds: hiraganaBalanceBounds,
    difficultyLevers: hiraganaDifficultyLevers,
    requiredShape: hiraganaRequiredShape,
    integerKeys: ["balance.choices", "balance.questionsPerSession"],
    minKanaSeen: 4,
    weakT: 0.6,
  }),
};

export function getProfile(game = "reflex") {
  const key = String(game || "reflex").trim();
  const profile = PROFILES[key];
  if (!profile) throw new Error(`未知の game: ${game}`);
  return profile;
}

const DEFAULT_PROFILE = PROFILES.reflex;
export const CONFIG_PATH = DEFAULT_PROFILE.CONFIG_PATH;
export const NOTES_PATH = DEFAULT_PROFILE.NOTES_PATH;
export const DECISION_PATH = DEFAULT_PROFILE.DECISION_PATH;
export const BALANCE_BOUNDS = DEFAULT_PROFILE.BALANCE_BOUNDS;
export const DIFFICULTY_LEVERS = DEFAULT_PROFILE.DIFFICULTY_LEVERS;
export const DIFFICULTY_LEVER_PATHS = DEFAULT_PROFILE.DIFFICULTY_LEVER_PATHS;
export const REQUIRED_SHAPE = DEFAULT_PROFILE.REQUIRED_SHAPE;

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

// 文字列の編集距離（Levenshtein）。誤字修正の“小ささ”判定に使う。
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// from→to が“誤字修正の範囲の小さな編集”か。これを超える改変は汚染/インジェクション疑い。
// decide（提案時）と gate（安全弁・独立再検証）が同じ判定を共有する＝多層防御。
export function isSmallTextEdit(from, to) {
  if (typeof from !== "string" || typeof to !== "string") return false;
  if (Math.abs(from.length - to.length) > TEXT_EDIT_MAX_LEN_DIFF) return false;
  const allowed = Math.max(TEXT_EDIT_MIN_ALLOWED, Math.ceil(from.length * TEXT_EDIT_RATIO));
  return levenshtein(from, to) <= allowed;
}
