# 自律パッチループ設計（瞬発ラボ）

このプロジェクトは「プレイヤーのコメント → AIが自動でパッチ → 配信」が
本当に回るかを検証するための最小実装です。
**「小修正は完全自動 / 大改修は人間承認」** のハイブリッドで事故を防ぎます。

## データの流れ

```
[プレイヤー] 終了画面でフィードバック (easy/just/hard + 一言)
     │  feedback.js が構造化して蓄積
     ▼
{ ts, configVersion, rating, comment, score }   ← 収集Agentが読む形
     │
     ▼
① 収集Agent   蓄積データを取得（現状 localStorage → 後で Turso/POST）
② 分類Agent   rating集計 + commentから要望/不満/バグを抽出・重大度付け
③ gate判定    下の「自動デプロイ許可ゾーン」を満たすか機械判定
     ├─ YES → ④へ（完全自動）
     └─ NO  → GitHub issue化して人間承認待ちで停止
④ 実装Agent   game-config.js の値だけ書き換え + version +1（worktree隔離）
⑤ 検証        構文チェック / スモークテスト（赤なら中止）
⑥ 配信        vercel deploy --prod + パッチノート生成 → X/Discord告知
```

## 自動デプロイ許可ゾーン（gate / AND条件）

1つでも外れたら自動デプロイせず、人間承認へ落とす。

- [x] 変更ファイルが `game-config.js` のみ
- [x] 変更が `balance` / `text` / `theme` の値のみ（キー追加・削除は禁止）
- [x] バランス値の1回の変更幅が ±25% 以内（急変で体験を壊さない）
- [x] `version` が +1 されている
- [x] 構文チェック（`node --check` 相当）が green
- [x] 直近に自動パッチを当てた config version へのネガティブ率が悪化していない

> ロジック（`game.js`）/ セーブ形式 / 新機能 に触る提案は**必ず**承認ゲート行き。

## 分類→調整のルール例（②③が使う指針）

| 集計シグナル | 自動調整 |
|---|---|
| 「難しすぎ」が多数 | `targetLifeMs`↑ / `targetSizePx`↑ / `spawnIntervalMs`↑（易化） |
| 「簡単すぎ」が多数 | 上記の逆（難化） |
| 「ちょうど良い」が多数 | 変更しない（無変更も正しい判断） |
| 誤字の指摘 | `text.*` を修正 |
| 少数の極端な声 | 母数 N 未満は無視（外れ値を実装しない） |

## 効果測定

各フィードバックに `configVersion` が刻まれるので、
パッチ後の version で「難しすぎ率 / ちょうど良い率」が改善したかを
次サイクルで自動評価できる（改善しなければ巻き戻し or 承認ゲート行き）。

## 段階導入（実装状況）

1. [x] ゲーム＋フィードバック蓄積が動く
2. [x] フィードバックを Turso にPOST（`api/feedback.js` + `feedback.js`、収集の自動化）
3. [x] ②③を Claude(API) + GitHub Actions cron で実装（`loop/` 一式、提案→PR）
4. [x] gate内に収まる小修正は main へ直接コミット＆本番デプロイ（`loop.yml` + Vercel git連携。PR運用は repo設定で切替可）
5. [x] パッチノート自動生成（`loop/notes.mjs`）＋ x-poster 告知フック（`loop/announce.mjs`、best-effort）

> 実装の入口は `loop/run.mjs`。ローカル検証は `npm run loop:dry`、単体テストは `npm test`。
> 安全弁の閾値は `loop/config.mjs` に集約。残りは外部リソースの provision と初回 cron 実走確認。
