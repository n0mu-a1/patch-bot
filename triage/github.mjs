// triage/github.mjs — 承認後、対象リポジトリへ repository_dispatch で「承認済み修正」を投げる。
// 対象リポ側の workflow（M2）が event_type "approved-fix" を受けて
//   エージェントで修正 → PR → 自動マージ → デプロイ する想定。
//
// 必要な env: GH_DISPATCH_TOKEN … 対象リポに repository_dispatch できる PAT（repo スコープ）。

export async function dispatchApprovedFix(repo, payload) {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) throw new Error("GH_DISPATCH_TOKEN is not set");
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "approved-fix", client_payload: payload }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`repository_dispatch failed: ${res.status} ${await res.text()}`);
  }
}
