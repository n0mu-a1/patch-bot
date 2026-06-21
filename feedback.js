// ====================================================================
// feedback.js  —  プレイヤーの声を「構造化データ」として収集する層
//
// 自律パッチループの入口。送信時に /api/feedback へ POST し Turso に蓄積する。
// オフライン/失敗時は localStorage キューに残し、次回まとめて再送する
// （声を1件も落とさないため）。export() はローカル控えを吐く。
//
// 差し替えポイントは ENDPOINT 一箇所。バックエンド無しで動かしたいときは
// ENDPOINT を null にすれば従来どおり localStorage だけで蓄積する。
// ====================================================================

window.Feedback = (function () {
  const MIRROR_KEY = "reflexlab_feedback_v1"; // ローカル控え（export用・バックアップ）
  const QUEUE_KEY = "reflexlab_feedback_queue_v1"; // 未送信キュー
  const ENDPOINT = "/api/feedback"; // null にするとローカルのみ
  let flushing = false;

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function record({ rating, comment, score }) {
    const entry = {
      ts: new Date().toISOString(),
      configVersion: window.GAME_CONFIG.version, // ★パッチ前後の効果測定に使う
      rating, // "easy" | "just" | "hard"
      comment: (comment || "").trim().slice(0, 280),
      score,
    };

    // ローカル控え（直近500件）
    const mirror = read(MIRROR_KEY);
    mirror.push(entry);
    write(MIRROR_KEY, mirror.slice(-500));

    // 送信キューへ積んで即フラッシュ（失敗しても残るので消えない）
    if (ENDPOINT) {
      const queue = read(QUEUE_KEY);
      queue.push(entry);
      write(QUEUE_KEY, queue.slice(-500));
      flush();
    }
    return entry;
  }

  // キューを順に送る。ネットワーク/一時障害なら残し次回再送、検証エラー(400)は破棄。
  async function flush() {
    if (!ENDPOINT || flushing) return;
    if (!navigator.onLine) return;
    flushing = true;
    try {
      let queue = read(QUEUE_KEY);
      while (queue.length) {
        const entry = queue[0];
        let drop = false;
        try {
          const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
            keepalive: true,
          });
          if (res.ok) drop = true; // 送信成功
          else if (res.status === 400) drop = true; // 不正データは捨てる（無限ループ防止）
          else break; // 429/503/5xx → 後で再送
        } catch {
          break; // オフライン等 → 後で再送
        }
        if (drop) { queue.shift(); write(QUEUE_KEY, queue); }
      }
    } finally {
      flushing = false;
    }
  }

  // 収集Agent / 開発者がローカル控えを吸い出す口（コンソールで Feedback.export()）。
  function exportJSON() {
    const json = JSON.stringify(read(MIRROR_KEY), null, 2);
    console.log(json);
    return json;
  }

  // 起動時・オンライン復帰時に取りこぼしを再送
  window.addEventListener("load", flush);
  window.addEventListener("online", flush);

  return { record, flush, load: () => read(MIRROR_KEY), export: exportJSON };
})();
