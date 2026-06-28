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

### ② 承認型（画像つき報告 → Discord承認 → 適用）※構築中
対象アプリのユーザーが画像つきで不具合報告 → patch-bot が収集 → Discord に通知 →
ボタン/リアクションで承認 → 対象アプリへ適用、という人間承認フロー（漢字ドリル方式）。

```
収集:   App → /api/report → Vercel Blob (reports/<app>/<日付>/<id>.json+jpg)
承認:   Blob列挙 → Discord通知 → 承認 → 対象リポジトリへ適用   ← 未実装
```

- 実装済: `api/report.js`（画像つき報告の収集 → Blob、`app` で対象識別）
- 未実装: Discord 連携（通知 / 承認 webhook / 適用オーケストレータ）

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
