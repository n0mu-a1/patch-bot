// ====================================================================
// loop/announce.mjs — ⑦配信告知（best-effort・任意）。
//
// x-poster(_lib/x-poster) は Playwright 専用プロファイルが要るためクラウドCIでは
// 動かない。よって既定はスキップし、ローカルや専用ランナーで REFLEX_ANNOUNCE=1 と
// REFLEX_XPOSTER_PATH を与えたときだけ投稿する。失敗してもループは止めない。
// ====================================================================

export async function announce(note, {
  enabled = process.env.REFLEX_ANNOUNCE === "1",
  posterPath = process.env.REFLEX_XPOSTER_PATH,
  gameLabel = "",
} = {}) {
  if (!enabled || !posterPath) return { posted: false, reason: "disabled" };
  try {
    const mod = await import(posterPath);
    const post = mod.postThread || mod.post || mod.default;
    if (typeof post !== "function") return { posted: false, reason: "poster関数なし" };
    const text = toAnnouncement(note, gameLabel);
    await post(text);
    return { posted: true };
  } catch (e) {
    return { posted: false, reason: e?.message || String(e) };
  }
}

function toAnnouncement(note, gameLabel = "") {
  const firstLines = note.split("\n").filter(Boolean).slice(0, 6).join("\n");
  const title = gameLabel ? `${gameLabel}をアップデートしました` : "瞬発ラボをアップデートしました";
  return `🔧 ${title}\n\n${firstLines}\n\n#瞬発ラボ`;
}
