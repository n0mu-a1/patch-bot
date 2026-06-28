-- ====================================================================
-- db/schema.sql — 自律パッチループの収集・効果測定スキーマ (Turso / libSQL)
-- 適用: turso db shell <db> < db/schema.sql   （CREATE ... IF NOT EXISTS で冪等）
-- ====================================================================

-- プレイヤーの声。収集Agent(loop/collect.mjs)はここを読む。
CREATE TABLE IF NOT EXISTS feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT    NOT NULL,                       -- クライアントのISO時刻
  config_version INTEGER NOT NULL,                       -- ★パッチ前後の効果測定キー
  rating         TEXT    NOT NULL CHECK (rating IN ('easy','just','hard')),
  comment        TEXT    NOT NULL DEFAULT '',
  score          INTEGER NOT NULL DEFAULT 0,
  game           TEXT    NOT NULL DEFAULT 'reflex',
  kana_json      TEXT,
  ua_hash        TEXT,                                   -- IP+UAのhash(個人情報は保存しない/濫用検知用)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_version ON feedback(config_version);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

-- 自律パッチの履歴。効果測定・ロールバック判断・gateの「直近自動パッチ」基準に使う。
CREATE TABLE IF NOT EXISTS patch_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version  INTEGER NOT NULL,
  to_version    INTEGER NOT NULL,
  action        TEXT    NOT NULL,                        -- patched | escalated | noop | rollback
  auto          INTEGER NOT NULL DEFAULT 1,              -- 1=完全自動, 0=人間承認
  summary       TEXT    NOT NULL DEFAULT '',
  diff_json     TEXT    NOT NULL DEFAULT '{}',
  stats_json    TEXT    NOT NULL DEFAULT '{}',           -- 判断時のrating集計スナップショット
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patchlog_to ON patch_log(to_version);
