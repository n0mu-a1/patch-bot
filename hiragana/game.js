(function () {
  const C = window.GAME_CONFIG, B = C.balance, T = C.text, TH = C.theme, KD = window.KANA_DATA, F = window.Feedback;
  const TABLE = Object.fromEntries(KD.kana.map((k) => [k.romaji, k]));
  const PRAISE = ["seikai", "yoku", "sugoi", "hanamaru"];
  const RETRY = ["mouichido", "oshii"];
  const CLEAR = "sugoi";
  const STATS_KEY = "hiragana_kana_v1";

  const promptAudio = new Audio();
  const praiseAudio = new Audio();
  let audioUnlocked = false;
  let selectedRating = null;
  let state = freshState();

  function $(id) {
    return document.getElementById(id);
  }

  const screenStart = $("screen-start");
  const screenQuiz = $("screen-quiz");
  const screenResult = $("screen-result");
  const elProgress = $("progress");
  const btnReplay = $("btn-replay");
  const elChoices = $("choices");
  const elFlower = $("flower");

  function freshState() {
    return {
      queue: [],
      idx: 0,
      total: 0,
      correctCount: 0,
      firstTryCorrect: 0,
      retries: 0,
      current: null,
      locked: false,
      wrongThisQ: false,
      advanceTimer: null,
      hintTimer: null,
      unlockTimer: null,
      awaitingFeedback: false,
    };
  }

  function applyTheme() {
    const root = document.documentElement.style;
    root.setProperty("--bg", TH.bg);
    root.setProperty("--card", TH.card);
    root.setProperty("--card-ink", TH.cardText);
    root.setProperty("--accent", TH.accent);
    root.setProperty("--accent-dim", TH.accentDim);
    root.setProperty("--correct", TH.correct);
    root.setProperty("--halo", TH.correctHalo);
    root.setProperty("--hanamaru", TH.hanamaru);
    root.setProperty("--dim", TH.dim);
  }

  function bindText() {
    $("app-title").textContent = T.title;
    $("btn-start").textContent = T.startButton;
    btnReplay.textContent = T.replayButton;
    btnReplay.setAttribute("aria-label", T.replayButton);
    $("btn-retry").textContent = T.retryButton;
    $("btn-home").textContent = T.homeButton;
    $("btn-home").setAttribute("aria-label", T.homeButton);
    $("result-text").textContent = T.resultPrefix;
    $("feedback-heading").textContent = T.feedbackHeading;
    $("fb-thanks").textContent = T.feedbackThanks;
    document.querySelectorAll(".rating-button").forEach((button) => {
      const rating = button.dataset.rating;
      button.textContent = T.ratings[rating];
    });
  }

  function wire() {
    $("btn-start").addEventListener("click", startSession);
    btnReplay.addEventListener("click", playPrompt);
    $("btn-retry").addEventListener("click", startSession);
    $("btn-home").addEventListener("click", goHome);
    document.querySelectorAll(".rating-button").forEach((button) => {
      button.addEventListener("click", () => {
        selectedRating = button.dataset.rating;
        document.querySelectorAll(".rating-button").forEach((b) => b.classList.toggle("selected", b === button));
      });
    });
    $("fb-submit").addEventListener("click", submitFeedbackManual);
  }

  function show(screen) {
    document.querySelectorAll("[data-screen]").forEach((el) => el.classList.add("hidden"));
    screen.classList.remove("hidden");
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    promptAudio.src = "audio/a.m4a";
    praiseAudio.src = "audio/seikai.m4a";
    [promptAudio, praiseAudio].forEach((audio) => {
      audio.muted = true;
      audio.play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => { audio.muted = false; });
    });
  }

  function playKana(romaji) {
    const item = TABLE[romaji];
    if (!item) return;
    promptAudio.src = "audio/" + item.audio;
    promptAudio.currentTime = 0;
    promptAudio.play().catch(() => {});
  }

  function playClip(name) {
    praiseAudio.src = "audio/" + name + ".m4a";
    praiseAudio.currentTime = 0;
    praiseAudio.play().catch(() => {});
  }

  function stopPrompt() {
    promptAudio.pause();
    promptAudio.currentTime = 0;
  }

  function loadKanaStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY) || "{}"); } catch { return {}; }
  }

  function saveKanaStats(s) {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  }

  function recordSeen(romaji) {
    const s = loadKanaStats();
    s[romaji] = s[romaji] || { seen: 0, correct: 0 };
    s[romaji].seen += 1;
    saveKanaStats(s);
  }

  function recordCorrect(romaji) {
    const s = loadKanaStats();
    s[romaji] = s[romaji] || { seen: 0, correct: 0 };
    s[romaji].correct += 1;
    saveKanaStats(s);
  }

  function correctRate(romaji) {
    const item = loadKanaStats()[romaji];
    return item?.seen ? item.correct / item.seen : 0;
  }

  function activePool() {
    const pool = KD.kana.filter((k) => (B.rows[k.row] || 0) > 0);
    return pool.length ? pool : KD.kana.filter((k) => k.row === "a");
  }

  function weightOf(k) {
    const stats = loadKanaStats();
    return (B.rows[k.row] || 1) * (1 + B.weakBoost * (1 - correctRate(k.romaji)) + (stats[k.romaji]?.seen ? 0 : B.newKanaBoost));
  }

  function weightedPick(items) {
    const weights = items.map(weightOf);
    const total = weights.reduce((sum, n) => sum + n, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function buildQueue() {
    const pool = activePool();
    const queue = [];
    const total = Math.max(1, Math.trunc(B.questionsPerSession));
    for (let i = 0; i < total; i++) {
      let candidates = pool;
      if (pool.length > 1 && queue.length) candidates = pool.filter((k) => k.romaji !== queue[queue.length - 1]);
      queue.push(weightedPick(candidates).romaji);
    }
    return queue;
  }

  function chooseDistractors(answer) {
    const wanted = Math.max(1, Math.trunc(B.choices) - 1);
    const picked = new Set([answer.romaji]);
    const out = [];
    const pool = activePool();
    while (out.length < wanted) {
      let source = pool;
      if (Math.random() < B.distractorSimilarity) {
        const similar = answer.confusables.map((r) => TABLE[r]).filter(Boolean);
        if (similar.length) source = similar;
      }
      const choices = source.filter((k) => !picked.has(k.romaji));
      if (!choices.length) break;
      const item = choices[Math.floor(Math.random() * choices.length)];
      picked.add(item.romaji);
      out.push(item.romaji);
    }
    const all = KD.kana.filter((k) => !picked.has(k.romaji));
    while (out.length < wanted && all.length) {
      const idx = Math.floor(Math.random() * all.length);
      const item = all.splice(idx, 1)[0];
      picked.add(item.romaji);
      out.push(item.romaji);
    }
    return out;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startSession() {
    clearTimers();
    submitPendingFeedback();
    unlockAudio();
    state = freshState();
    state.queue = buildQueue();
    state.total = state.queue.length;
    show(screenQuiz);
    renderProgress();
    nextQuestion();
  }

  function nextQuestion() {
    clearTimers();
    if (state.idx >= state.total) return endSession();
    state.current = TABLE[state.queue[state.idx]];
    state.wrongThisQ = false;
    state.locked = false;
    recordSeen(state.current.romaji);
    renderProgress();
    renderChoices(state.current);
    playPrompt();
  }

  function playPrompt() {
    if (!state.current) return;
    stopPrompt();
    playKana(state.current.romaji);
  }

  function renderChoices(answer) {
    const options = shuffle([answer.romaji, ...chooseDistractors(answer)]);
    elChoices.innerHTML = "";
    options.forEach((romaji) => {
      const item = TABLE[romaji];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "kana-card";
      card.dataset.romaji = romaji;
      card.setAttribute("aria-label", item.kana);
      card.textContent = item.kana;
      card.addEventListener("click", () => onChoiceTap(romaji, card));
      elChoices.append(card);
    });
  }

  function onChoiceTap(romaji, el) {
    if (state.locked) return;
    if (romaji === state.current.romaji) handleCorrect(el);
    else handleWrong(el);
  }

  function handleCorrect(el) {
    state.locked = true;
    el.classList.add("correct");
    if (!state.wrongThisQ) {
      state.firstTryCorrect += 1;
      recordCorrect(state.current.romaji);
    }
    state.correctCount += 1;
    showFlower();
    playClip(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
    fillProgressSlot(state.idx);
    state.advanceTimer = setTimeout(() => {
      if (screenQuiz.classList.contains("hidden")) return;
      hideFlower();
      state.idx += 1;
      nextQuestion();
    }, B.autoAdvanceMs);
  }

  function handleWrong(el) {
    state.locked = true;
    state.wrongThisQ = true;
    state.retries += 1;
    el.classList.add("dim", "shake");
    playClip(RETRY[Math.floor(Math.random() * RETRY.length)]);
    const question = state.current;
    state.hintTimer = setTimeout(() => {
      if (screenQuiz.classList.contains("hidden")) return;
      if (state.current !== question) return;
      highlightCorrectCard();
    }, B.retryHintDelayMs);
    state.unlockTimer = setTimeout(() => {
      if (screenQuiz.classList.contains("hidden")) return;
      state.locked = false;
    }, B.wrongLockMs);
  }

  function endSession() {
    show(screenResult);
    renderResult(T.resultPrefix, state.correctCount);
    playClip(CLEAR);
    resetFeedbackUI();
    state.awaitingFeedback = true;
  }

  function renderProgress() {
    elProgress.innerHTML = "";
    for (let i = 0; i < state.total; i++) {
      const slot = document.createElement("span");
      slot.className = "slot" + (i < state.correctCount ? " filled" : "");
      elProgress.append(slot);
    }
  }

  function fillProgressSlot(i) {
    const slot = elProgress.children[i];
    if (slot) slot.classList.add("filled");
  }

  function showFlower() {
    elFlower.classList.remove("hidden");
  }

  function hideFlower() {
    elFlower.classList.add("hidden");
  }

  function highlightCorrectCard() {
    elChoices.querySelectorAll(".kana-card").forEach((card) => {
      card.classList.toggle("halo", card.dataset.romaji === state.current?.romaji);
    });
  }

  function clearTimers() {
    clearTimeout(state.advanceTimer);
    clearTimeout(state.hintTimer);
    clearTimeout(state.unlockTimer);
    state.advanceTimer = null;
    state.hintTimer = null;
    state.unlockTimer = null;
  }

  function goHome() {
    clearTimers();
    submitPendingFeedback();
    stopPrompt();
    hideFlower();
    show(screenStart);
  }

  function renderResult(prefix, count) {
    $("result-text").textContent = prefix;
    $("result-mark").textContent = Array.from({ length: count }, () => "💮").join("");
  }

  function resetFeedbackUI() {
    selectedRating = null;
    $("fb-thanks").classList.add("hidden");
    document.querySelectorAll(".rating-button").forEach((button) => button.classList.remove("selected"));
  }

  function deriveRating() {
    const q = state.total;
    const firstTryRate = q ? state.firstTryCorrect / q : 0;
    const retriesPerQ = q ? state.retries / q : 0;
    return (firstTryRate < 0.55 || retriesPerQ >= 1.0) ? "hard"
      : (firstTryRate >= 0.90 && retriesPerQ < 0.15) ? "easy"
      : "just";
  }

  function submitFeedbackAuto() {
    F.record({ rating: deriveRating(), comment: "", score: state.firstTryCorrect, game: "hiragana", kana: loadKanaStats() });
  }

  function submitPendingFeedback() {
    if (!state.awaitingFeedback) return;
    submitFeedbackAuto();
    state.awaitingFeedback = false;
  }

  function submitFeedbackManual() {
    if (!state.awaitingFeedback) return;
    F.record({ rating: selectedRating || deriveRating(), comment: "", score: state.firstTryCorrect, game: "hiragana", kana: loadKanaStats() });
    state.awaitingFeedback = false;
    $("fb-thanks").classList.remove("hidden");
  }

  applyTheme();
  bindText();
  wire();
  F.flush();
  show(screenStart);
})();
