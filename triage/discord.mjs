// triage/discord.mjs — Discord 連携の最小ヘルパ（Iris/src/lib/discord.ts の移植・JS版）。
// Bot token でチャンネルに投稿/リアクション付与/リアクション読み取りするだけ。依存は fetch と env のみ。
//
// 必要な env:
//   DISCORD_BOT_TOKEN   … Bot トークン（必須・Iris の Bot を流用）
//   （投稿先 channelId は呼び出し側がアプリごとに渡す。後述 apps.mjs 参照）
// 投稿/リアクション/リアクション読み取りは privileged intent 不要。

const API = "https://discord.com/api/v10";

function botHeaders() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");
  return { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
}

// 投稿してメッセージIDを返す。リアクション承認はこのIDに紐付ける。
export async function postMessage(content, channelId) {
  if (!channelId) throw new Error("channelId is required");
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: botHeaders(),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`discord post failed: ${res.status} ${await res.text()}`);
  const m = await res.json();
  return m.id;
}

// Bot 自身のリアクションを先付け（オーナーがワンタップで承認/拒否できるように）。
export async function addReaction(messageId, emoji, channelId) {
  const e = encodeURIComponent(emoji);
  const res = await fetch(
    `${API}/channels/${channelId}/messages/${messageId}/reactions/${e}/@me`,
    { method: "PUT", headers: botHeaders() },
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`discord react failed: ${res.status} ${await res.text()}`);
  }
}

// 指定メッセージに emoji でリアクションしたユーザーIDの一覧（Bot 自身も含む）。
export async function fetchReactionUserIds(messageId, emoji, channelId) {
  const e = encodeURIComponent(emoji);
  const res = await fetch(
    `${API}/channels/${channelId}/messages/${messageId}/reactions/${e}?limit=100`,
    { headers: botHeaders() },
  );
  if (!res.ok) throw new Error(`discord reactions fetch failed: ${res.status} ${await res.text()}`);
  const users = await res.json();
  return users.map((u) => u.id);
}
