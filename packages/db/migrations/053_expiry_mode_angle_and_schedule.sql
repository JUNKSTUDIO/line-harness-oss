-- 053_expiry_mode_angle_and_schedule.sql
-- ① カード有効期限を「最終利用日から」/「発行日から」で切替可能にする。
-- ② スタンプの押し方 (斜め/まっすぐ) を切替可能にする。
-- ③ ポイント倍率ルールに「毎月○日」の条件タイプを追加する。
--    condition_type は既存CHECK制約の対象列のため、SQLiteの仕様上ALTERで
--    制約だけを変更することができない。テーブルを再作成して列を追加する。

ALTER TABLE card_settings ADD COLUMN card_expiry_mode TEXT NOT NULL DEFAULT 'since_last_stamp' CHECK (card_expiry_mode IN ('since_last_stamp', 'since_issue'));
ALTER TABLE card_settings ADD COLUMN card_expiry_days_from_issue INTEGER;
ALTER TABLE card_settings ADD COLUMN stamp_angle_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE point_multiplier_rules_new (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  multiplier        REAL NOT NULL CHECK (multiplier > 0),
  condition_type    TEXT NOT NULL CHECK (condition_type IN ('manual', 'weekday', 'time_range', 'period', 'weather', 'day_of_month')),
  weekday           INTEGER CHECK (weekday BETWEEN 0 AND 6),
  day_of_month      INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  time_start        TEXT,
  time_end          TEXT,
  starts_at         TEXT,
  ends_at           TEXT,
  weather_condition TEXT CHECK (weather_condition IN ('rain', 'snow')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  priority          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO point_multiplier_rules_new (
  id, line_account_id, name, multiplier, condition_type, weekday, time_start, time_end,
  starts_at, ends_at, weather_condition, is_active, priority, created_at, updated_at
)
SELECT
  id, line_account_id, name, multiplier, condition_type, weekday, time_start, time_end,
  starts_at, ends_at, weather_condition, is_active, priority, created_at, updated_at
FROM point_multiplier_rules;

DROP TABLE point_multiplier_rules;
ALTER TABLE point_multiplier_rules_new RENAME TO point_multiplier_rules;

CREATE INDEX IF NOT EXISTS idx_point_multiplier_rules_account_active ON point_multiplier_rules (line_account_id, is_active);
