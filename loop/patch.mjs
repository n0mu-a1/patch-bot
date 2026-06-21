// ====================================================================
// loop/patch.mjs — ④実装。提案差分を game-config.js のテキストに反映する。
//   ・コメント/書式を壊さず、対象キー行の値トークンだけを外科的に置換
//   ・楽観ロック: 現値が diff.from と一致しなければ throw（陳腐化差分を弾く）
//   ・version は +1（version 行は厳密に1つであることを要求）
//   ・キー/文言が一意に特定できなければ throw（曖昧なら触らない＝安全側）
// 純粋なテキスト変換なので単体テストしやすい。書き込みは run.mjs が行う。
// ====================================================================

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `key: <number>` の数値だけを置換。指数表記の取り違え/桁崩れを防ぐため
// 既存トークンは指数も含めて丸ごと捕捉し、新値は指数表記を禁止する。
function replaceNumberByKey(text, key, from, to) {
  if (typeof to !== "number" || !Number.isFinite(to) || /[eE]/.test(String(to))) {
    throw new Error(`不正な数値(指数表記/NaN不可): ${key}=${to}`);
  }
  const num = "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";
  const re = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*:\\s*)(${num})(.*)$`, "gm");
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) throw new Error(`キー ${key} が一意でない (一致 ${matches.length} 件)`);
  const current = Number(matches[0][2]);
  if (from !== undefined && current !== from) {
    throw new Error(`楽観ロック失敗: ${key} 現値 ${current} ≠ 前提 ${from}`);
  }
  return text.replace(re, (_m, pre, _numTok, rest = "") => `${pre}${to}${rest}`);
}

// `key: "literal"` の文字列だけを置換（キー行に限定。コメント重複に強い）。
function replaceStringByKey(text, key, from, to) {
  if (typeof to !== "string") throw new Error(`不正な文言: ${key}`);
  const str = '"(?:\\\\.|[^"\\\\])*"';
  const re = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*:\\s*)(${str})(.*)$`, "gm");
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) throw new Error(`キー ${key} の文言が一意でない (一致 ${matches.length} 件)`);
  let current;
  try { current = JSON.parse(matches[0][2]); } catch { throw new Error(`文言リテラルを解釈できない: ${key}`); }
  if (from !== undefined && current !== from) {
    throw new Error(`楽観ロック失敗: ${key} 現文言 ${JSON.stringify(current)} ≠ 前提 ${JSON.stringify(from)}`);
  }
  return text.replace(re, (_m, pre, _strTok, rest = "") => `${pre}${JSON.stringify(to)}${rest}`);
}

function bumpVersion(text) {
  const re = /^(\s*version\s*:\s*)(\d+)(.*)$/gm;
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) throw new Error(`version 行が一意でない (一致 ${matches.length} 件)`);
  return text.replace(re, (_m, pre, n, rest = "") => `${pre}${Number(n) + 1}${rest}`);
}

// 差分配列を適用した新テキストを返す（version も +1）。
export function computePatch(oldText, diff) {
  let text = oldText;
  for (const d of diff) {
    const key = d.path.split(".").pop();
    if (d.kind === "text") text = replaceStringByKey(text, key, d.from, d.to);
    else if (d.kind === "balance") text = replaceNumberByKey(text, key, d.from, d.to);
    else throw new Error(`未知のdiff種別: ${d.kind}`);
  }
  return bumpVersion(text);
}
