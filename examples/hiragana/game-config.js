// game-config.js — AI 自動修正ゾーン / ひらがな おとあて
// loop/* が書換える唯一のファイル。値だけ変更可。変更したら version+1。
// 制約(reflex-lab loop/config.mjs): 配列/関数/getter/Symbol 不可・balance数値・theme=#rrggbb。
// 出題行は activeRows配列でなく rows{} の数値重み(0..1, 0=出さない)で表現する。
window.GAME_CONFIG = {
  version: 1,

  balance: {
    // ── 自動レバー(loopが±25%/回・1リーフ/回で動かす連続値) ──
    distractorSimilarity: 0.6, // 0..1 紛らわしさ。大=似た字で難 / 小=易（主レバー, easeSign -1）
    autoAdvanceMs: 1400,       // 正解→次問の待ち(ms)。大=ゆっくり=易い体感（easeSign +1）
    weakBoost: 2.0,            // 端末ローカル苦手かなの重点度。大=苦手集中=難（easeSign -1）
    // ── 人間承認のみ(escalate。loop自動変更不可) ──
    choices: 3,                // カード枚数。3択設計の中核（[2,4]整数）
    questionsPerSession: 7,    // 1セッション問数=花丸スロット数（[5,20]整数）
    newKanaBoost: 1.5,         // 初出かなの出題重み
    wrongLockMs: 600,          // 誤答後の一瞬の入力ロック(ms)。減点は無し
    retryHintDelayMs: 1200,    // 誤答後、正解カードを光らせ始める間(ms)
    rows: {                    // 出題行の重み(0..1)。0=出さない。あ行から段階解放(人間承認)
      a: 1, ka: 1, sa: 1, ta: 0, na: 0,
      ha: 0, ma: 0, ya: 0, ra: 0, wa: 0
    }
  },

  text: {                      // 子は読めない前提=最小。ratings は親/loop入力用(自動変更禁止)
    title: "おとあて",
    startButton: "▶ はじめる",
    replayButton: "🔊 もういちど",
    retryButton: "▶ もういちど",
    homeButton: "🏠",
    resultPrefix: "はなまる",
    feedbackHeading: "むずかしさは どうでしたか？",
    feedbackThanks: "ありがとう！",
    ratings: { easy: "かんたん", just: "ちょうどいい", hard: "むずかしい" }
  },

  theme: {                     // 明るいこども色。全て #rrggbb / accent≠bg（gate必須）
    bg: "#fff7e6", card: "#ffffff", cardText: "#2b2b2b",
    accent: "#ff7aa2", accentDim: "#ffb3c6",
    correct: "#54d18c", correctHalo: "#ffc23c",
    hanamaru: "#e8413b", dim: "#d9d4c7"
  }
};
