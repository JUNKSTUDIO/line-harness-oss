-- 049_card_settings_address_and_operators.sql
-- ① 緯度経度の手入力をやめ、住所文字列から自動でジオコーディングするための列。
-- ② 天候チェック間隔を店舗ごとに設定可能にする。
-- ③ QRスタンプ付与の不正利用防止 — 事前登録されたLINEアカウントのみ付与を許可する。

ALTER TABLE card_settings ADD COLUMN shop_address TEXT;
ALTER TABLE card_settings ADD COLUMN weather_check_interval_minutes INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS card_grant_operators (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  line_user_id    TEXT NOT NULL,
  display_name    TEXT,
  picture_url     TEXT,
  registered_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_card_grant_operators_account ON card_grant_operators (line_account_id);
