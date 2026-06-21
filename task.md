# 瞬発ラボ — 自律パッチループ構築タスク

LOOP.md の「段階導入」を実装するチェックリスト。

## ステージ1: ゲーム＋フィードバック蓄積（土台）
- [x] ゲーム本体（game.js / styles.css / index.html / PWA一式）
- [x] フィードバックUI（easy/just/hard + 一言）

## ステージ2: 収集の自動化（Turso化）
- [x] `db/schema.sql`（feedback / patch_log テーブル）
- [x] `api/feedback.js`（Vercel serverless：検証＋連投抑制＋Turso insert）
- [x] `feedback.js` を POST 化（失敗時 localStorage キューで再送）

## ステージ3: 提案→PR（Claude subagent + GHA cron）
- [x] `loop/collect.mjs` 収集（Turso / seed）
- [x] `loop/classify.mjs` 分類（rating集計 + Claudeでコメントから誤字/バグ/要望抽出）
- [x] `loop/decide.mjs` 調整案（難易度→balance易化/難化、誤字→text、バグ/要望→escalate）
- [x] `loop/gate.mjs` 安全弁（AND条件の機械判定・純関数）
- [x] `loop/patch.mjs` 外科的テキスト置換 + version+1
- [x] `loop/verify.mjs` 構文/形状/安全域/version 検証
- [x] `loop/notes.mjs` パッチノート生成
- [x] `loop/run.mjs` オーケストレーション（decision.json 出力）
- [x] `loop/gate.test.mjs` 単体テスト（緑）
- [x] gate 敵対検証（複数エージェントで突破試行）
- [x] `.github/workflows/loop.yml`（cron→run→PR/issue）

## ステージ4: gate内自動マージ＆デプロイ（完全自動）
- [x] PR 自動マージ（`gh pr merge --squash --admin`）
- [x] Vercel git 連携で main マージ→本番自動デプロイ
- [ ] 外部リソース provision（GitHub / Turso / Vercel / secrets）
- [ ] 初回 cron 実走で PR/issue 経路を確認

## ステージ5: パッチノート＆告知
- [x] `loop/notes.mjs` で PATCHNOTES.md 自動更新
- [x] `loop/announce.mjs`（x-poster 告知フック・best-effort）
- [ ] 告知の実接続（ローカル/専用ランナーで REFLEX_ANNOUNCE=1）

## 運用メモ
- ローカル検証: `npm run loop:dry`（seed に対するドライラン）
- テスト: `npm test`
- 安全弁の閾値は `loop/config.mjs`（MIN_N / DECISION_MARGIN / STEP / MAX_DELTA / REGRESSION_EPS / BALANCE_BOUNDS）
