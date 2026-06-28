# patch-bot — タスク

reflex-lab（反射神経ゲーム＋自律パッチループ）を、ゲームを剥がして
「対象アプリの不具合修正ツール」に転換中。対象アプリは別リポジトリ
（hiragana = `/Users/im/AI/hiragana`、kanji-drill = `/Users/im/AI/kanji-drill`）。

## 完了
- [x] reflex-lab → patch-bot にリネーム（GitHub repo / ローカルdir / remote）
- [x] 瞬発ラボ（ゲーム）・あそびハブUI・同梱 hiragana を削除
- [x] `loop/` をテンプレ化（config を `examples/` に退避、53テスト緑）
- [x] 旧 autopatch cron(loop.yml) を撤去、CI(ci.yml = テスト実行)に置換
- [x] `api/report.js`（承認型の収集→Blob、`app` で対象識別）を移植
- [x] README / package.json / vercel.json をツール向けに更新

## 自立型（既存・各アプリへ配る）
- [ ] hiragana リポジトリの自前 loop を patch-bot/loop の最新と同期する運用を決める
- [ ] examples の命名整理（reflex→より中立な名前にするか検討）

## 承認型
M1（patch-bot側オーケストレーション・REST ポーリング方式）:
- [x] `triage/discord.mjs`（Iris の discord lib を移植）
- [x] `triage/store.mjs`（Blob 報告の列挙/読取/状態更新）
- [x] `triage/draft.mjs`（修正趣旨の起草・無料 heuristic / 任意 Groq）
- [x] `triage/notify.mjs`（新規報告→Discord投稿＋✅/❌→awaiting）
- [x] `triage/resolve.mjs`（リアクション判定→承認は対象リポへ dispatch）
- [x] `.github/workflows/triage.yml`（15分 cron）/ 単体テスト（承認判定 等）

M2（対象リポ側・実装）:
- [ ] 対象リポに `approved-fix`(repository_dispatch) を受ける workflow
- [ ] エージェントで修正→PR→自動マージ→デプロイ（hiragana から）
- [ ] 対象アプリに報告UI（画像添付）を追加し `/api/report` へ POST

承認型の env / secrets:
- [ ] Discord: Iris の `DISCORD_BOT_TOKEN` 流用 / `DISCORD_OWNER_ID`（自分のID）
- [ ] アプリ別チャンネル作成 → `DISCORD_CHANNEL_<APP>` / `TARGET_REPO_<APP>`
- [ ] `GH_DISPATCH_TOKEN`（対象リポへ dispatch する PAT）

## インフラ
- [ ] Vercel: reflex-lab-two を patch-bot サービスに流用（relink / 必要なら rename）
- [ ] env: BLOB_READ_WRITE_TOKEN / REPORT_ALLOW_ORIGIN / Discord 各種
