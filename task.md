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

## 承認型（構築中）
- [ ] Discord アプリ作成（bot token / public key / application id）
- [ ] 新規報告 → Discord 通知（画像＋本文＋メタ、reports/<app>/ を列挙）
- [ ] 承認 webhook（`api/discord-interactions.js`：署名検証＋ボタン操作）
- [ ] 承認 → 対象アプリリポジトリへ適用するオーケストレータ（修正の出し方を設計）
- [ ] 対象アプリ側に報告UI（画像添付）を追加（hiragana から）

## インフラ
- [ ] Vercel: reflex-lab-two を patch-bot サービスに流用（relink / 必要なら rename）
- [ ] env: BLOB_READ_WRITE_TOKEN / REPORT_ALLOW_ORIGIN / Discord 各種
