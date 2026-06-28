// triage/store.mjs — Vercel Blob 上の報告レコードを列挙・読取・更新する。
// レイアウト: reports/<app>/<日付>/<id>.json （api/report.js が書く）。
// 各レコードは triage.status を内包: "new" → "awaiting" → "approved"/"rejected"。

import { list, put } from "@vercel/blob";

const PREFIX = "reports/";

// 全 .json レコードを返す（必要なら status で絞り込み）。volume が増えたら cursor 追従。
export async function listReports({ status = null } = {}) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) {
      if (!b.pathname.endsWith(".json")) continue;
      const res = await fetch(b.downloadUrl || b.url, { cache: "no-store" });
      if (!res.ok) continue;
      let record;
      try { record = await res.json(); } catch { continue; }
      if (status && (record?.triage?.status || "new") !== status) continue;
      out.push({ pathname: b.pathname, record });
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

// 単一レコードを pathname で取得（ボタン承認エンドポイントが該当報告だけ読む用）。
export async function getReport(pathname) {
  const page = await list({ prefix: pathname, limit: 1 });
  const b = page.blobs.find((x) => x.pathname === pathname) || page.blobs[0];
  if (!b) return null;
  const res = await fetch(b.downloadUrl || b.url, { cache: "no-store" });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// 同一 pathname へ上書き保存（addRandomSuffix:false なので冪等に更新できる）。
export async function updateReport(pathname, record) {
  await put(pathname, JSON.stringify(record, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}
