// triage/draft.mjs — 報告レコードから {summary, fixIntent} を起草する。
// summary  … 不具合内容の要約（オーナーが読む）
// fixIntent … 修正する趣旨（承認後に対象リポのエージェントが従う方針）
//
// コスト方針は classify と同じ: 既定(auto)は無料のみ。
//   GROQ_API_KEY 有 → Groq 無料枠でLLM起草 / 無 → キー不要 heuristic。失敗時は heuristic へフォールバック。
//   PATCHBOT_DRAFT_PROVIDER=heuristic で完全オフライン固定、=groq で Groq 明示。

const MODEL_GROQ = process.env.PATCHBOT_GROQ_MODEL || "llama-3.3-70b-versatile";

function providerChain(env = process.env) {
  const p = (env.PATCHBOT_DRAFT_PROVIDER || "").trim().toLowerCase();
  if (p === "groq") return ["groq", "heuristic"];
  if (p === "heuristic" || p === "none" || p === "off") return ["heuristic"];
  if (p) { console.warn(`[draft] 未知の PATCHBOT_DRAFT_PROVIDER="${p}" → heuristic`); return ["heuristic"]; }
  return env.GROQ_API_KEY ? ["groq", "heuristic"] : ["heuristic"];
}

function clip(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }

// LLM 不要の素朴起草。報告本文をそのまま方針に落とす（$0・送信なし）。
function heuristicDraft(record) {
  const comment = clip(record.comment, 280);
  const where = clip(record?.meta?.screen || record?.meta?.mode || "", 24);
  const summary = comment || "（コメントなし・画像のみの報告）";
  const fixIntent =
    `報告内容を再現・調査し、${where ? `「${where}」周辺の` : ""}該当箇所を最小差分で修正する。` +
    `挙動を変える大改修は避け、不具合の解消に必要な範囲に留める。`;
  return { summary, fixIntent, provider: "heuristic" };
}

async function groqDraft(record) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const sys =
    "あなたはバグ報告のトリアージ担当。報告（コメント・画面・メタ）から、" +
    "(1)不具合の要約 summary（日本語1〜2文）と (2)修正方針 fixIntent（日本語1〜2文・具体的だが小さく安全な範囲）を作る。" +
    'JSON のみで {"summary": "...", "fixIntent": "..."} を返す。';
  const user = JSON.stringify({
    comment: clip(record.comment, 480),
    meta: { screen: record?.meta?.screen, mode: record?.meta?.mode, url: record?.meta?.url },
    hasImage: Boolean(record.imageUrl),
  });
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_GROQ,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`groq draft failed: ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const summary = clip(parsed.summary, 280);
  const fixIntent = clip(parsed.fixIntent, 280);
  if (!summary || !fixIntent) throw new Error("groq draft incomplete");
  return { summary, fixIntent, provider: "groq" };
}

export async function draftFix(record) {
  for (const provider of providerChain()) {
    try {
      if (provider === "heuristic") return heuristicDraft(record);
      if (provider === "groq") return await groqDraft(record);
    } catch (err) {
      console.error(`[draft] provider=${provider} skip:`, err?.message || err);
    }
  }
  return heuristicDraft(record); // 最終フォールバック
}
