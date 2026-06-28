// ====================================================================
// loop/verify.mjs — ⑤検証。パッチ後の game-config.js が「壊れていない」かを確認。
//   1) 構文/実行/注入: VM評価 + プレーンデータ正規化（getter/非列挙/関数を拒否）
//   2) 形状:          game.js が読む必須キーの存在・型・想定外キー無し
//   3) 値の妥当性:    balance 絶対域 / 文言の長さ・制御文字 / theme は #rrggbb
//   4) version:       正の整数、かつ期待値（旧+1）と一致
// ====================================================================

import { execFileSync } from "node:child_process";
import { loadConfigFromText, flatten, getProfile, THEME_COLOR_RE, DANGEROUS_TEXT_RE } from "./config.mjs";

export function verifyText(newText, { expectedVersion, profile = getProfile("reflex") } = {}) {
  const errors = [];

  let cfg;
  try {
    cfg = loadConfigFromText(newText); // 構文・注入・getter/非列挙はここで throw
  } catch (e) {
    return { ok: false, errors: [`構文/実行/注入エラー: ${e.message}`] };
  }

  const flat = flatten(cfg);

  // 必須キーの存在・型・有限性・文字列の中身
  for (const [path, type] of Object.entries(profile.REQUIRED_SHAPE)) {
    const val = flat[path];
    if (val === undefined) { errors.push(`必須キー欠落: ${path}`); continue; }
    if (typeof val !== type) { errors.push(`型不一致: ${path} は ${type} 期待 (実際 ${typeof val})`); continue; }
    if (type === "number" && !Number.isFinite(val)) errors.push(`数値が不正(NaN/Inf): ${path}`);
    if (type === "string") {
      if (val.length > profile.TEXT_MAX) errors.push(`文言が長すぎる(>${profile.TEXT_MAX}): ${path}`);
      if (DANGEROUS_TEXT_RE.test(val)) errors.push(`制御/不可視文字(bidi等)を含む: ${path}`);
      if (path.startsWith("theme.")) {
        if (!THEME_COLOR_RE.test(val)) errors.push(`配色は #rrggbb 形式のみ: ${path}=${val}`);
      } else if (/[<>]/.test(val)) {
        errors.push(`文言にHTMLメタ文字を含む: ${path}`); // gate と独立に弾く（多層防御）
      }
    }
  }

  // 想定外キーの追加が無いこと（REQUIRED_SHAPE は全リーフを網羅）
  for (const path of Object.keys(flat)) {
    if (!(path in profile.REQUIRED_SHAPE)) errors.push(`想定外のキー追加: ${path}`);
  }

  // balance 絶対安全域
  for (const [key, bounds] of Object.entries(profile.BALANCE_BOUNDS)) {
    const val = key.includes(".")
      ? key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), cfg.balance)
      : cfg.balance?.[key];
    if (typeof val === "number" && (val < bounds[0] || val > bounds[1])) {
      errors.push(`バランス値が安全域外: balance.${key}=${val} (許容 ${bounds[0]}..${bounds[1]})`);
    }
  }

  // version は正の整数（expectedVersion 省略時もこれは必ず検査する）
  if (!Number.isInteger(cfg.version) || cfg.version < 1) {
    errors.push(`version は正の整数であるべき: ${cfg.version}`);
  } else if (expectedVersion != null && cfg.version !== expectedVersion) {
    errors.push(`version 不一致: ${cfg.version} (期待 ${expectedVersion})`);
  }

  for (const path of profile.INTEGER_KEYS || []) {
    const v = flat[path];
    if (v !== undefined && !Number.isInteger(v)) errors.push(`整数であるべき: ${path}=${v}`);
  }

  return { ok: errors.length === 0, errors, config: cfg };
}

// 実ファイルに対する `node --check`（VM検証に加え、本物のNode構文チェックも通す）。
export function nodeCheck(path) {
  try {
    execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message) };
  }
}
