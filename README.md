# 瞬発ラボ (reflex-lab)

本番: **https://reflex-lab-two.vercel.app** ／ リポジトリ: `n0mu-a1/reflex-lab`(private)

光った的を消える前にタップする30秒の反射神経ゲーム（静的PWA）。
本当の目的は **「プレイヤーのコメント → AIが game-config.js を自動パッチ → 配信」の自律ループ** を、
事故を起こさず完全自動で回せるかを検証する土台を作ること。

```
収集:   Player → /api/feedback (Vercel) → Turso(feedback)
ループ: GHA cron(6h) → loop/run.mjs
        ① 収集(Turso)
        ② 分類: rating集計 + Claudeでコメントから誤字/バグ/要望抽出
        ③ 判断: 難易度→balance易化/難化、誤字→text修正、バグ/要望→人間承認
        ④ gate(安全弁): game-config.jsのみ / balance・text・theme値のみ / ±25% / version+1 / 構文 / 回帰
            ├ pass  → patch → 検証 → main へ直接コミット → Vercel本番デプロイ → 告知(best-effort)
            └ fail  → GitHub issue で人間承認待ち
```

## 構成

| ファイル | 役割 | AI自動修正 |
|---|---|---|
| `index.html` / `styles.css` | 画面・見た目 | - |
| `game.js` | ゲームロジック | ❌ 触らせない |
| **`game-config.js`** | バランス値 / 文言 / テーマ | ✅ **自動修正ゾーン** |
| `feedback.js` | 声を構造化して /api/feedback へ送信（失敗時ローカル再送） | - |
| `api/feedback.js` | 収集エンドポイント（検証＋Turso insert） | - |
| `db/schema.sql` | feedback / patch_log テーブル | - |
| `loop/*.mjs` | 収集→分類→判断→**gate**→patch→検証→ノート | - |
| `loop/gate.mjs` | **安全弁**（自動デプロイ許可ゾーンの機械判定・純関数） | - |
| `.github/workflows/loop.yml` | cron→run→main直接コミット / issue起票 | - |
| `LOOP.md` | 設計とgate条件 | - |

## ローカルで動かす

```sh
cd /Users/im/AI/reflex-lab
npm install
npm run serve         # → http://localhost:5173 でゲーム
npm test              # gate/verify/patch の単体テスト
npm run loop:dry      # seed-feedback.json に対するループのドライラン
```

`loop:dry` は外部リソース不要。`game-config.js` は書き換えず、判断結果と差分プレビューだけ出す。

## ループの動かし方

- **ドライラン（安全・既定）**: `node loop/run.mjs --dry-run --seed seed-feedback.json`
- **本番適用（CI）**: `node loop/run.mjs --apply`（Turso/Anthropic の env が要る。`game-config.js` を更新し `decision.json` を出力）
- 出力 `decision.json` を `loop.yml` が読み、`patch`(applied=true)→main直接コミット / `escalate`→issue / `noop`→何もしない。
  - 監査証跡は main のコミット + `PATCHNOTES.md` + Turso `patch_log`。PR自動マージ運用にしたい場合は、リポジトリ設定で「GitHub Actions に PR の作成・承認を許可」をON にし、`loop.yml` の patch 分岐を PR フローへ戻す。

安全弁の閾値はすべて `loop/config.mjs`（`MIN_N` / `DECISION_MARGIN` / `STEP` / `MAX_DELTA` / `REGRESSION_EPS` / `BALANCE_BOUNDS`）。

## デプロイ / 必要な secret

Vercel は Git 連携で main へのマージごとに本番デプロイ。GHA に以下の secret を設定：

| secret | 用途 |
|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | フィードバック収集の読み（ループ） |
| `ANTHROPIC_API_KEY` | コメントNLP（無くても rating集計だけで動く） |

Vercel 側 env にも `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（+任意 `FEEDBACK_ALLOW_ORIGIN`）を設定（`/api/feedback` 用）。

## 安全設計（なぜ完全自動でも事故らないか）

- 自動で触れるのは `game-config.js` の **値だけ**（キー追加・削除・ロジックは不可）。
- バランス変更は **1回±25%以内** かつ **絶対安全域内**、`version` は厳密に **+1**。
- 構文/形状/想定外キーを `loop/verify.mjs` がVMサンドボックスで検証（注入コードはここで弾く）。
- gate を1つでも外したら **自動デプロイせず issue で人間承認**。
- 直近の自動パッチでネガ率が悪化していたら **自動モードを止める**（回帰サーキットブレーカ）。

詳細とgate条件は `LOOP.md`、進捗は `task.md`。
