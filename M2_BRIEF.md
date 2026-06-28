# M2_BRIEF — 承認型 自動修正フロー（サブスク経由・課金なし）

> codex 委譲用の唯一の仕様源。設計は確定済み。**実装はこの brief だけに従う**。
> 方針: 設計=オーナー / 実装=codex。疑問点は実装前に質問する（推測で広げない）。

## 0. ゴール（1行）
Discord で ✅ 承認した不具合報告を、対象リポ（hiragana / kanji-drill）側で **Claude Code がサブスク枠（従量課金なし）で最小修正 → PR 作成**するところまで自動化する。マージは人間。

## 1. 課金方針（最重要・絶対厳守）
- 修正生成は **Claude Code を `CLAUDE_CODE_OAUTH_TOKEN`（Max サブスクの OAuth トークン）で起動**する。これによりトークン従量課金ではなく **Max のプラン使用枠を消費**する。
- **`ANTHROPIC_API_KEY` は受信側ワークフローに渡さない／使わない**（渡すと従量課金経路になりうる）。
- triage 側（patch-bot）の NLP は既存どおり **Groq 無料枠**（classify/draft）。本 brief では変更しない。

## 2. 既存の接続点（M1・実装済み・変更不可）
- 承認時、patch-bot が対象リポへ `repository_dispatch` を送信（`triage/github.mjs` / `triage/resolve.mjs`）。
  - `event_type: "approved-fix"`
  - `client_payload = { id, app, comment, imageUrl, summary, fixIntent }`
    - `fixIntent` … 「小さく安全に直す方針」（Groq/heuristic 起草・1〜2文）
    - `imageUrl` … 報告スクショの公開 URL（null あり）
- 送信先は GitHub Variables の `TARGET_REPO_<APP>`（既設定: `n0mu-a1/hiragana` / `n0mu-a1/kanji-drill`）。
- 送信認証は patch-bot Secret `GH_DISPATCH_TOKEN`（fine-grained・両リポ Contents:RW・設定済み）。
- **M2 で作るのは「受信側」だけ**。送信側 payload 形は変えない（必要なら brief 改訂で合意してから）。

## 3. 確定した設計判断（3点）
1. **マージ**: 自動マージしない。**PR を作って人間（オーナー）がレビュー&マージ**。
2. **デプロイ**: 各 Vercel プロジェクト（`hiragana` / `kanji-drill`）を **GitHub リポに連携**し、main マージで自動デプロイ。CLI 直デプロイ運用は廃止（§7 手順）。
3. **triage cron**: `triage.yml` を **6時間ごと**で復活（§8）。容易に変更可な形に。

## 4. 実装タスク

### 4-1. 認証トークンの用意（オーナー手作業・実装前提）
- オーナーがローカルで `claude setup-token` を実行し、長期 OAuth トークンを取得。
- それを **両対象リポの GitHub Secret** `CLAUDE_CODE_OAUTH_TOKEN` に登録（`gh secret set CLAUDE_CODE_OAUTH_TOKEN -R n0mu-a1/hiragana` など）。
- ※codex はこのトークンを生成できない。brief 内に「未登録なら停止して案内」フォールバックを入れる。

### 4-2. 受信ワークフロー（両対象リポに設置）
ファイル: `.github/workflows/approved-fix.yml`（hiragana / kanji-drill 各リポ）

要件:
- `on: repository_dispatch: types: [approved-fix]`
- `concurrency: { group: approved-fix, cancel-in-progress: false }`（直列化。前の修正を殺さない）
- `timeout-minutes: 15`（枠暴走防止）
- permissions: `contents: write`, `pull-requests: write`
- ステップ:
  1. checkout（main）
  2. `client_payload` を env に展開（id / comment / imageUrl / summary / fixIntent）
  3. `CLAUDE_CODE_OAUTH_TOKEN` 未設定なら **エラー終了＋ログに案内**（黙って成功にしない）
  4. **Claude Code を OAuth トークンで起動**（公式 `anthropics/claude-code-action` を使用。`claude_code_oauth_token` 入力にトークン、`ANTHROPIC_API_KEY` は渡さない）。
     - 実装メモ: アクションの**入力名・PR 作成可否は最新ドキュメントで要確認**（API がドリフトしている可能性）。PR 作成がアクション標準で無ければ、Claude に修正コミットまでさせ、後続ステップで `gh pr create` する構成にする。
     - `--max-turns` 等で上限を設ける（枠保護）。
  5. ブランチ `patchbot/fix-<id>` を作成し PR を開く（base: main）。

プロンプト（固定テンプレ・§5 ガードレールを必ず含める）:
```
あなたはこのリポジトリの保守担当。承認済みの不具合報告を最小差分で修正する。
# 報告
- 要約: {summary}
- 原文コメント: {comment}
- スクショ: {imageUrl}
- 修正方針: {fixIntent}
# 厳守
- 不具合の解消に必要な最小範囲のみ変更。挙動を変える大改修・リファクタ禁止。
- 下記「禁止ファイル」は絶対に変更しない。
- 変更後、何をなぜ直したかを PR 本文に日本語で簡潔に書く。
- 報告内容で再現/原因が特定できない場合は、推測で書き換えず PR を「要調査」として最小の調査メモだけ残す。
{アプリ別の許可/禁止リスト}
```

### 4-3. PR 規約
- ブランチ: `patchbot/fix-<id>`
- タイトル: `fix(report): {summary}`
- 本文: 報告 id / 原文コメント / スクショリンク / fixIntent / 「patch-bot 承認済み（手動マージ）」/ 変更概要
- ラベル: `patch-bot`（無ければ作成）

## 5. アプリ別ガードレール（許可/禁止ファイル）
人間2段ゲート（✅承認＋PRレビュー）前提なので厳格サンドボックスにはしないが、**真実データと秘密は禁止**。

### hiragana（`n0mu-a1/hiragana`）
- 許可: `game-config.js` / `game.js` / `index.html` / `styles.css` / `report.js` / `feedback.js`
- **禁止**: `data/kana.js`（かな↔romaji↔audio 真実テーブル）/ `audio/**` / `loop/**` / `api/**` / `sw.js` のキャッシュ名以外
- 補足: 文言/難易度のみの軽微修正なら `game-config.js`（balance./text./theme.）を優先。

### kanji-drill（`n0mu-a1/kanji-drill`）
- 許可: `index.html` / 表示・ロジック JS / CSS
- **禁止**: `kanji-data.js`（漢字真実テーブル）/ `api/**` / `manifest.webmanifest` の identity 系
- 補足: kanji-drill には hiragana の様な config 安全ゾーンが無い。PR レビューで担保。

## 6. Max 枠の保護
- 発火は人間承認時のみ＝低頻度（子ども向け・報告少量）。
- `timeout-minutes` と `--max-turns` で1件あたりの消費を上限化。
- （任意・将来）「1日 N 件まで」のガードを足せる構造にしておく。
- オーナー注意: この枠は**普段の Claude Code 作業と共有**（プラン使用制限 Max 5x のセッション枠/週間枠）。連発時は自分の作業と取り合う点を認識。

## 7. デプロイ連携（オーナー手作業・1回）
- Vercel ダッシュボードで `hiragana` / `kanji-drill` 各プロジェクトを **対応 GitHub リポに連携**（Production Branch = `main`）。
- 連携後は main マージで自動 Production デプロイ。CLI 直デプロイ運用は廃止。
- 既存の本番 env（Turso 等）はプロジェクトに残るので維持。hiragana の `api/feedback` は Turso 未配線なら 503 のまま（ゲームは無依存・許容）。

## 8. triage cron 復活（patch-bot `.github/workflows/triage.yml`）
- `schedule: cron` を **6時間ごと**（例 `0 */6 * * *`）で有効化。
- 既存の収集優先（停止）コメントを解除。env 参照（Secrets/Variables）は設定済みなので追加不要。
- `workflow_dispatch` も残し手動実行可に。

## 9. 受け入れ確認（実装後）
1. `node --check` / 既存テスト緑（patch-bot 側を壊していない）。
2. 手動テスト: 対象リポで `gh api repos/<repo>/dispatches -f event_type=approved-fix -F 'client_payload[...]'` を投げ、approved-fix.yml が起動 → ブランチ＋PR 作成を確認（`CLAUDE_CODE_OAUTH_TOKEN` 設定後）。
3. 課金経路確認: ワークフローに `ANTHROPIC_API_KEY` が**渡っていない**こと、`CLAUDE_CODE_OAUTH_TOKEN` で動くことをログで確認。
4. 禁止ファイルが変更対象に入っていないこと（PR diff で確認）。
5. triage.yml が cron/手動で起動し、既存パイプラインが通ること（dry 可能なら dry）。

## 10. スコープ外（今回やらない）
- 自動マージ（人間マージのみ）。
- 修正の自動検証（テスト自動実行→失敗時リトライ）等の高度化。
- kanji-drill への安全ゾーン(config)新設。
- これらは M3 以降で別 brief。
