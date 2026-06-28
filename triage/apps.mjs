// triage/apps.mjs — アプリごとの設定を env から引く（チャンネル / 対象リポジトリ）。
// app 識別子は /api/report の `app` と同じ（小文字・[a-z0-9-]）。
//
// 規約: app "kanji-drill" なら
//   DISCORD_CHANNEL_KANJI_DRILL … その app の報告を流す Discord チャンネルID
//   TARGET_REPO_KANJI_DRILL     … 承認後に修正を投げる GitHub リポジトリ (owner/name)
// （- は _ に、英字は大文字に正規化）

export const APPROVE_EMOJI = "✅";
export const REJECT_EMOJI = "❌";

// ボタン即時承認用。custom_id = `pb:<action>:<blob pathname>`（Discord上限100文字）。
// pathname は reports/<app>/<日付>/<id>.json で ~60 文字に収まる。
export const CUSTOM_ID_PREFIX = "pb";
export function approvalButtons(pathname) {
  return [{
    type: 1, // action row
    components: [
      { type: 2, style: 3, label: "✅ 承認", custom_id: `${CUSTOM_ID_PREFIX}:approve:${pathname}` },
      { type: 2, style: 4, label: "❌ 却下", custom_id: `${CUSTOM_ID_PREFIX}:reject:${pathname}` },
    ],
  }];
}

export function envKey(prefix, app) {
  return `${prefix}_${String(app).toUpperCase().replace(/-/g, "_")}`;
}

export function channelOf(app, env = process.env) {
  return env[envKey("DISCORD_CHANNEL", app)] || null;
}

export function repoOf(app, env = process.env) {
  return env[envKey("TARGET_REPO", app)] || null;
}

export function ownerId(env = process.env) {
  return env.DISCORD_OWNER_ID || null;
}

// 承認判定（純関数・テスト対象）。オーナーのリアクションだけを見る。
//   拒否が押されていれば reject 優先（誤承認より安全側）。
export function approvalDecision({ ownerId, approvers = [], rejecters = [] }) {
  if (!ownerId) return "pending";
  if (rejecters.includes(ownerId)) return "reject";
  if (approvers.includes(ownerId)) return "approve";
  return "pending";
}
