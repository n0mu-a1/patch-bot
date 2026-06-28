// ====================================================================
// feedback.js  —  プレイヤーの声を「構造化データ」として収集する層
//
// 自律パッチループの入口。送信時に /api/feedback へ POST し Turso に蓄積する。
// オフライン/失敗時は localStorage キューに残し、次回まとめて再送する。
// ====================================================================

window.Feedback = (function () {
  const MIRROR_KEY = "hiragana_feedback_v1";
  const QUEUE_KEY = "hiragana_feedback_queue_v1";
  const ENDPOINT = "/api/feedback";
  let flushing = false;

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function record({ rating, comment, score, game, kana }) {
    const entry = {
      ts: new Date().toISOString(),
      configVersion: window.GAME_CONFIG.version,
      rating,
      comment: (comment || "").trim().slice(0, 280),
      score,
      game: game || "hiragana",
      kana: kana || {},
    };

    const mirror = read(MIRROR_KEY);
    mirror.push(entry);
    write(MIRROR_KEY, mirror.slice(-500));

    if (ENDPOINT) {
      const queue = read(QUEUE_KEY);
      queue.push(entry);
      write(QUEUE_KEY, queue.slice(-500));
      flush();
    }
    return entry;
  }

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
          if (res.ok) drop = true;
          else if (res.status === 400) drop = true;
          else break;
        } catch {
          break;
        }
        if (drop) { queue.shift(); write(QUEUE_KEY, queue); }
      }
    } finally {
      flushing = false;
    }
  }

  function exportJSON() {
    const json = JSON.stringify(read(MIRROR_KEY), null, 2);
    console.log(json);
    return json;
  }

  window.addEventListener("load", flush);
  window.addEventListener("online", flush);

  return { record, flush, load: () => read(MIRROR_KEY), export: exportJSON };
})();
