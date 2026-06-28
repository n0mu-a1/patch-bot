# patch-bot

リポジトリ: `n0mu-a1/patch-bot`(private)

対象アプリ（hiragana / kanji-drill 等）の**不具合を修正するためのツール**。
2つの修正経路を提供する。元は反射神経ゲーム「瞬発ラボ(reflex-lab)」だったが、
ゲームを剥がして修正エンジンだけを残し、patch-bot に改名した。

## 2つの修正経路

### ① 自立型（フィードバック → AI自動パッチ → 配信）
プレイヤーの評価/コメントから、安全な範囲の値（balance/text/theme）だけを自動調整する。
`loop/` がその実装で、**各対象アプリのリポジトリにテンプレとして配って app 内 cron で回す**
（このリポジトリでは config を自動コミットしない）。

```
収集:   Player → /api/feedback → Turso(feedback)
ループ: loop/run.mjs（各アプリのGHA cron）
        ① 収集 ② 分類(無料provider chain) ③ 判断 ④ gate(安全弁)
            ├ pass → patch → verify → main へコミット → デプロイ
            └ fail → GitHub issue で人間承認
```

安全弁 gate の条件: `game-config.js` のみ / balance・text・theme 値のみ / ±25% /
version+1 / 構文green / 回帰なし。1つでも外れたら escalate（人間承認）。

### ② 承認型（画像つき報告 → Discord承認 → 適用）
対象アプリのユーザーが画像つきで不具合報告 → patch-bot が収集 → Discord に通知 →
オーナーが ✅/❌ リアクションで承認 → 承認分を対象リポジトリへ投げる（漢字ドリル方式）。
常駐 bot 不要の **REST ポーリング方式**（cron 15分間隔）。

```
① 収集:   App → /api/report → Vercel Blob (reports/<app>/<日付>/<id>.json+jpg)   triage=new
② 通知:   triage/notify  新規報告 → 修正趣旨を起草 → Discord 投稿 + ✅/❌     triage=awaiting
③ 判定:   triage/resolve ✅/❌ をポーリング → オーナー ✅ なら対象リポへ        triage=approved/rejected
                          repository_dispatch(approved-fix) ← M2 が受けて実装
```

- 実装済(M1): `api/report.js`（収集→Blob）、`triage/`（discord / store / draft / notify / resolve / github dispatch）
- 未実装(M2): 対象リポ側で `approved-fix` を受けてエージェント修正→PR→自動マージする workflow

実行: `node triage/run.mjs both`（`--dry-run` で書き込みなし）。

必要な env: `BLOB_READ_WRITE_TOKEN` / `DISCORD_BOT_TOKEN`（Iris の Bot を流用）/
`DISCORD_OWNER_ID`（承認者）/ `GH_DISPATCH_TOKEN`（対象リポへ dispatch する PAT）/
アプリ別に `DISCORD_CHANNEL_<APP>` と `TARGET_REPO_<APP>`（例 `DISCORD_CHANNEL_HIRAGANA`）/
`GROQ_API_KEY`（任意・修正趣旨をLLM起草。無ければ無料 heuristic）。

## 構成

| パス | 役割 |
|---|---|
| `loop/` | 自立型の修正エンジン＆テンプレ（gate/verify/decide/patch/classify…）。単体テスト同梱 |
| `api/feedback.js` | 自立型の収集エンドポイント（→ Turso） |
| `api/report.js` | 承認型の収集エンドポイント（→ Vercel Blob） |
| `db/` | Turso スキーマ / マイグレーション |
| `examples/` | loop が直す対象 config のサンプル（テスト・デモ用。reflex/hiragana の2形状） |

## 開発

```sh
npm test            # loop の安全弁テスト
npm run loop:dry    # examples/reflex の seed でドライラン
```

## デプロイ

Vercel プロジェクト（収集API＋承認サービスの置き場）。
必要な env: `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（feedback）、
`BLOB_READ_WRITE_TOKEN`（report）、`REPORT_ALLOW_ORIGIN`（任意・対象アプリのオリジン）。
Discord 連携の env は実装時に追加。
