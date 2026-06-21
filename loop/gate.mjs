// ====================================================================
// loop/gate.mjs — ③自動デプロイ許可ゾーンの機械判定（安全弁の中核・純関数）
//
// LOOP.md の AND 条件を1つでも外したら pass=false（→ 人間承認へ落とす）。
//   1. 変更ファイルは game-config.js のみ（ドキュメントを除く）
//   2. 構造が同一（balance/text/theme のキー追加・削除を禁止）
//   3. version が厳密に +1
//   4. 変更は自動ゾーン(balance/text/theme)の値のみ。
//      balance は数値・絶対安全域・1回±25%以内。text/theme は文字列のみ。
//   5. 直近自動パッチ基準よりネガティブ率が悪化していない
// ====================================================================

import {
  flatten, BALANCE_BOUNDS, MAX_DELTA, MAX_BALANCE_CHANGES, REGRESSION_EPS,
  DIFFICULTY_LEVER_PATHS, THEME_COLOR_RE, TEXT_MAX, DANGEROUS_TEXT_RE, isSmallTextEdit,
} from "./config.mjs";

const ALLOWED_DOCS = new Set(["PATCHNOTES.md", "decision.json", "task.md"]);
const ALLOWED_ZONES = ["balance.", "text.", "theme."];
const pct = (x) => `${Math.round(x * 100)}%`;

export function gate({ oldConfig, newConfig, changedFiles = ["game-config.js"], regression = { available: false } }) {
  const failures = [];

  // 1) 変更ファイルは game-config.js のみ
  const nonDoc = [...changedFiles].filter((f) => !ALLOWED_DOCS.has(f));
  if (!(nonDoc.length === 1 && nonDoc[0] === "game-config.js")) {
    failures.push(`変更ファイルが game-config.js 単独でない: [${nonDoc.join(", ") || "なし"}]`);
  }

  const oldFlat = flatten(oldConfig);
  const newFlat = flatten(newConfig);

  // 2) 構造同一（キー追加/削除の禁止）
  const added = Object.keys(newFlat).filter((k) => !(k in oldFlat));
  const removed = Object.keys(oldFlat).filter((k) => !(k in newFlat));
  if (added.length) failures.push(`キー追加禁止: ${added.join(", ")}`);
  if (removed.length) failures.push(`キー削除禁止: ${removed.join(", ")}`);

  // 3) version は厳密に +1
  if (!(Number.isInteger(newConfig.version) && newConfig.version === oldConfig.version + 1)) {
    failures.push(`version は +1 必須: ${oldConfig.version} → ${newConfig.version}`);
  }

  // 4) 変更されたリーフの検査
  let balanceChanges = 0;
  for (const key of Object.keys(newFlat)) {
    if (!(key in oldFlat)) continue; // added は検出済み
    const ov = oldFlat[key];
    const nv = newFlat[key];
    if (ov === nv || key === "version") continue;

    if (!ALLOWED_ZONES.some((z) => key.startsWith(z))) {
      failures.push(`自動ゾーン外の変更: ${key}`);
      continue;
    }

    if (key.startsWith("balance.")) {
      balanceChanges++;
      // 4a) 自動で動かしてよいのは難易度レバーだけ（スコア体系は人間承認）
      if (!DIFFICULTY_LEVER_PATHS.has(key)) {
        failures.push(`難易度レバー外のbalance自動変更は不可（人間承認へ）: ${key}`);
      }
      const leaf = key.split(".").pop();
      const bounds = BALANCE_BOUNDS[leaf];
      if (typeof ov !== "number" || typeof nv !== "number" || !Number.isFinite(nv)) {
        failures.push(`バランス値が数値でない: ${key} ${ov}→${nv}`);
        continue;
      }
      if (bounds && (nv < bounds[0] || nv > bounds[1])) {
        failures.push(`バランス値が安全域外: ${key}=${nv} (許容 ${bounds[0]}..${bounds[1]})`);
      }
      if (ov === 0) {
        failures.push(`基準値0からの自動変更は不可（人間承認へ）: ${key}`);
      } else {
        const delta = Math.abs(nv - ov) / Math.abs(ov);
        if (delta > MAX_DELTA + 1e-9) {
          failures.push(`変化幅が±${pct(MAX_DELTA)}超: ${key} ${ov}→${nv} (${pct(delta)})`);
        }
      }
    } else if (key.startsWith("theme.")) {
      if (typeof nv !== "string" || !THEME_COLOR_RE.test(nv)) {
        failures.push(`配色は #rrggbb 形式のみ: ${key}=${nv}`);
      }
    } else {
      // text.*
      if (key.startsWith("text.ratings.")) {
        // フィードバックの選択肢ラベルはループ自身の入力定義。自動変更を禁止。
        failures.push(`評価ラベル(${key})の自動変更は不可（人間承認へ）`);
      }
      if (typeof ov !== "string" || typeof nv !== "string") {
        failures.push(`文言は文字列のみ: ${key}`);
      } else if (nv.length > TEXT_MAX) {
        failures.push(`文言が長すぎる(>${TEXT_MAX}): ${key}`);
      } else if (/[<>]/.test(nv)) {
        failures.push(`文言にHTMLメタ文字を含む（人間承認へ）: ${key}`);
      } else if (DANGEROUS_TEXT_RE.test(nv)) {
        // 双方向制御(RLO)・ゼロ幅・BOM 等の不可視/表示偽装文字（LLM経路の汚染対策）
        failures.push(`文言に制御/不可視文字(bidi等)を含む（人間承認へ）: ${key}`);
      } else if (!isSmallTextEdit(ov, nv)) {
        // 安全弁として decide を信頼せず、文言変更が誤字修正の範囲かを独立再検証する
        failures.push(`文言変更が誤字修正の範囲を超える（人間承認へ）: ${key}`);
      }
    }
  }
  // 4z) 1サイクルで動かせる balance リーフ数の上限（累積破壊の防止）
  if (balanceChanges > MAX_BALANCE_CHANGES) {
    failures.push(`balance同時変更が多すぎる: ${balanceChanges}個 (上限 ${MAX_BALANCE_CHANGES})`);
  }
  // 4y) 的(accent)と背景(bg)が同色＝不可視化を防ぐ
  if (newFlat["theme.accent"] === newFlat["theme.bg"]) {
    failures.push("theme.accent と theme.bg が同色（的が不可視）");
  }

  // 5) 回帰ガード（直近自動パッチ基準よりネガ率が悪化していない）
  if (regression.available) {
    const worse = regression.currentNegRate - regression.baselineNegRate;
    if (worse > REGRESSION_EPS + 1e-9) {
      failures.push(`ネガ率が悪化: ${pct(regression.currentNegRate)} > 基準 ${pct(regression.baselineNegRate)} + 許容 ${pct(REGRESSION_EPS)}`);
    }
  }

  return { pass: failures.length === 0, failures };
}
