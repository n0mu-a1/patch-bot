// ====================================================================
// game.js  —  ゲームロジック（★AI自動修正ゾーン外。ループは触らない）
// ====================================================================

(function () {
  const C = window.GAME_CONFIG;
  const B = C.balance;
  const T = C.text;

  // テーマ反映
  const root = document.documentElement.style;
  root.setProperty("--accent", C.theme.accent);
  root.setProperty("--accent-dim", C.theme.accentDim);
  root.setProperty("--bg", C.theme.bg);

  // DOM
  const $ = (id) => document.getElementById(id);
  const hud = $("hud"), field = $("field");
  const elTime = $("hud-time"), elScore = $("hud-score"), elCombo = $("hud-combo");
  const screenStart = $("screen-start"), screenResult = $("screen-result");

  // 文言の流し込み
  $("title").textContent = T.title;
  $("tagline").textContent = T.tagline;
  $("btn-start").textContent = T.startButton;
  $("btn-retry").textContent = T.retryButton;
  $("cfg-ver").textContent = C.version;
  $("fb-heading").textContent = T.feedbackHeading;
  $("fb-comment").placeholder = T.feedbackPlaceholder;
  $("fb-submit").textContent = T.feedbackSubmit;
  $("fb-thanks").textContent = T.feedbackThanks;
  document.querySelector('[data-rate="easy"]').textContent = T.ratings.easy;
  document.querySelector('[data-rate="just"]').textContent = T.ratings.just;
  document.querySelector('[data-rate="hard"]').textContent = T.ratings.hard;

  // ベストスコア
  const BEST_KEY = "reflexlab_best";
  const getBest = () => Number(localStorage.getItem(BEST_KEY) || 0);
  const setBest = (v) => localStorage.setItem(BEST_KEY, String(v));
  function showBest(el) {
    const b = getBest();
    el.textContent = b > 0 ? `${T.bestPrefix} ${b}` : "";
  }
  showBest($("best-start"));

  // ゲーム状態
  let state = null;

  function startGame() {
    screenStart.classList.add("hidden");
    screenResult.classList.add("hidden");
    hud.classList.remove("hidden");
    field.classList.remove("hidden");
    field.innerHTML = "";

    state = { score: 0, combo: 0, timeLeft: B.roundSeconds, running: true, timers: [] };
    render();

    state.tick = setInterval(() => {
      state.timeLeft--;
      if (state.timeLeft <= 0) endGame();
      else render();
    }, 1000);

    state.spawner = setInterval(spawnTarget, B.spawnIntervalMs);
    spawnTarget();
  }

  function render() {
    elTime.textContent = state.timeLeft;
    elScore.textContent = state.score;
    elCombo.textContent = state.combo;
  }

  function spawnTarget() {
    if (!state || !state.running) return;
    const size = B.targetSizePx;
    const rect = field.getBoundingClientRect();
    const pad = 8;
    const x = pad + Math.random() * Math.max(0, rect.width - size - pad * 2);
    const y = pad + Math.random() * Math.max(0, rect.height - size - pad * 2);

    const el = document.createElement("div");
    el.className = "target";
    el.style.width = el.style.height = size + "px";
    el.style.left = x + "px";
    el.style.top = y + "px";

    let alive = true;
    const kill = (hit) => {
      if (!alive) return;
      alive = false;
      clearTimeout(life);
      if (hit) {
        state.combo++;
        state.score += B.hitScore + state.combo * B.comboBonus;
        el.classList.add("dying");
        setTimeout(() => el.remove(), 180);
      } else {
        state.combo = 0;
        state.score = Math.max(0, state.score - B.missPenalty);
        el.remove();
      }
      render();
    };

    el.addEventListener("pointerdown", (e) => { e.preventDefault(); kill(true); });
    field.appendChild(el);
    const life = setTimeout(() => kill(false), B.targetLifeMs);
  }

  function endGame() {
    state.running = false;
    clearInterval(state.tick);
    clearInterval(state.spawner);
    field.innerHTML = "";
    hud.classList.add("hidden");
    field.classList.add("hidden");

    const finalScore = state.score;
    if (finalScore > getBest()) setBest(finalScore);

    $("result-label").textContent = T.resultPrefix;
    $("result-score").textContent = finalScore;
    showBest($("result-best"));
    resetFeedbackUI(finalScore);
    screenResult.classList.remove("hidden");
  }

  // --- フィードバックUI ---
  let chosenRating = null, lastScore = 0;
  function resetFeedbackUI(score) {
    lastScore = score;
    chosenRating = null;
    document.querySelectorAll(".fb-rate").forEach((b) => b.classList.remove("selected"));
    $("fb-comment").value = "";
    $("fb-thanks").classList.add("hidden");
    $("fb-submit").disabled = false;
  }

  document.querySelectorAll(".fb-rate").forEach((btn) => {
    btn.addEventListener("click", () => {
      chosenRating = btn.dataset.rate;
      document.querySelectorAll(".fb-rate").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });

  $("fb-submit").addEventListener("click", () => {
    if (!chosenRating) { /* 評価未選択は軽く促す */ document.querySelector(".fb-ratings").animate(
      [{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 180 });
      return; }
    window.Feedback.record({ rating: chosenRating, comment: $("fb-comment").value, score: lastScore });
    $("fb-thanks").classList.remove("hidden");
    $("fb-submit").disabled = true;
  });

  $("btn-start").addEventListener("click", startGame);
  $("btn-retry").addEventListener("click", startGame);
})();
