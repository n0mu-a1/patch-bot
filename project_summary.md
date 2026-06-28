# patch-bot 進行サマリ

## 目的
対象アプリ（hiragana / kanji-drill 等）の不具合修正ツール。2経路:
① 自立型（feedback→AI自動パッチ→配信、`loop/` をテンプレ配布） ② 承認型（画像つき報告→Discord承認→対象リポへ dispatch、`triage/`）。
元 reflex-lab からゲームを剥がして改名。詳細は README.md / task.md。

## 完了
- reflex-lab→patch-bot リネーム（repo/dir/remote）、ゲーム削除、loop をテンプレ化（examples/ に退避）
- 承認型 M1 実装（triage: discord/store/draft/notify/resolve/github）＋テスト緑、cron は収集優先で停止中
- `api/report.js`（収集→Blob、`app` 識別、CORS対応）
- 3コミット push 済み（〜16beb4a）
- Vercel: Blob ストア `patch-bot`(store_EumbF5se15k5O3Uq) を作成し reflex-lab プロジェクトにリンク。
  `BLOB_READ_WRITE_TOKEN` を Production/Preview/Development に設定済み。
  本番ドメイン = https://reflex-lab-two.vercel.app （hiragana の report.js 送信先と一致）

## 2026-06-29 進捗（report 疎通 + Discord/env 本番反映 完了）
- **patch-bot 本番再デプロイ済み**（`vercel --prod --yes`）。`BLOB_READ_WRITE_TOKEN`(45分前作成) を反映するため再デプロイが必要だった（env 設定後の再デプロイで初めて runtime 反映）。
- **report 疎通 OK**: hiragana から `/api/report` に1件 POST → `{ok:true}` / Blob `reports/hiragana/2026-06-28/<id>.json` 保存確認。テスト artifact 1件残置（mass-delete が auto-mode でブロック・無害）。
- **対象アプリを GitHub 化**: `n0mu-a1/hiragana`・`n0mu-a1/kanji-drill` を新規作成・push（どちらも従来 Vercel CLI 直デプロイで GitHub repo 不在だった）。→ **kanji-drill の「完全不可触」前提は解除**（GitHub 管理下に）。
- **Discord 通知チャンネル作成**（IRIS サーバー）: `#ひらがな-報告`=1520821640412270833 / `#漢字ドリル-報告`=1520821556048298055。iris Bot で投稿疎通確認済み（BOT は1体で app 別チャンネルに投げ分け方式）。
- **GHA env 本番反映済み（`n0mu-a1/patch-bot`）**: triage.yml は Secrets と Variables を読む。
  - Secrets ✅ = DISCORD_BOT_TOKEN(iris流用) / DISCORD_OWNER_ID(793136798565400628) / BLOB_READ_WRITE_TOKEN / GH_DISPATCH_TOKEN(fine-grained: hiragana+kanji-drill の Contents:RW・有効性200確認) / GROQ_API_KEY / ANTHROPIC_API_KEY / TURSO×2
  - Variables ✅ = DISCORD_CHANNEL_HIRAGANA / _KANJI_DRILL / TARGET_REPO_HIRAGANA(n0mu-a1/hiragana) / _KANJI_DRILL(n0mu-a1/kanji-drill)
  - 値は patch-bot ローカル `.env.local`(gitignore) にも保持。`.env.example` に Discord/TARGET テンプレ追記済み。
  - ⚠️ GH_DISPATCH_TOKEN はチャットに平文露出→気になれば rotate 推奨。
- 補足: triage の NLP は **Groq**（GROQ_API_KEY）。承認型の課金源は M2 の「自動修正(コード生成)」工程のみ（報告受信・Discord通知・PR作成は無料）。

## M2 実装・E2E完了（2026-06-29）— サブスク枠で 承認→自動修正→PR が全線開通
- 設計確定: `M2_BRIEF.md`（唯一の仕様源）。3判断=①人間マージ ②Vercel↔GitHub連携で自動デプロイ ③triage cron 6h。
- **受信WF `approved-fix.yml`** を hiragana/kanji-drill に設置。`repository_dispatch: [approved-fix]` 受信 → 報告をファイル化(インジェクション対策) → `anthropics/claude-code-action@v1` を **CLAUDE_CODE_OAUTH_TOKEN(Max枠)** で起動(ANTHROPIC_API_KEY不使用) → `--allowedTools Edit,Read,Write,Glob,Grep` で最小修正 → **禁止ファイル検知で中断** → 自前shellで branch `patchbot/fix-<id>`・commit・PR。
- **triage.yml cron 6h 復活**（`0 */6 * * *`、workflow_dispatch併用）。
- ハマり所と対処（重要）:
  1. GitHub Actions が **account locked(支払い2か月失敗・$2.81 declined)** で全停止 → オーナーが Payment method 更新で解除。
  2. 3リポ public 化（私）— ただし真因はaccount lockだったので public は必須ではなかった。
  3. claude-code-action が **OIDC要求で失敗** → `github_token: ${{ secrets.GITHUB_TOKEN }}` を明示渡しで解決(id-token/ GitHub App 不要)。
  4. PR作成が **"Actions not permitted to create PR"** → 各リポ Actions設定 `can_approve_pull_request_reviews=true`(オーナー実行) + `patch-bot` ラベル作成。
- **E2E実証(hiragana)**: 報告dispatch → Claudeが game-config.js に praiseVolume 追加+game.js反映(最小差分) → **PR #1 自動作成(ラベル付)** を確認 → テスト後始末済(PR close/branch削除/dispatch-test.yml撤去)。
- 前提: 全リポの Secret `CLAUDE_CODE_OAUTH_TOKEN` 登録済(`claude setup-token`)。

## 残タスク
- [ ] **kanji-drill の approved-fix を E2E未実施**（WF/Secret/トグル/ラベルは設置済。hiraganaと同一構造なので同等動作の見込み）。
- [ ] **Vercel↔GitHub 連携(§7)**: hiragana/kanji-drill 各VercelプロジェクトをGitHubリポにリンク(Production=main)→ マージで自動デプロイ。オーナー手作業・未実施。
- [ ] triage cron(6h) は稼働開始済。実報告での承認→dispatch 通し確認は今後の運用で。
- [ ] `REPORT_ALLOW_ORIGIN`：未設定=全許可。hiragana本番オリジン確定後に絞る（任意）。
- [ ] チャット平文露出した GH_DISPATCH_TOKEN / DISCORD_BOT_TOKEN は気になれば rotate（任意）。
