-- 051_card_settings_weather_anchor.sql
-- 天候チェック間隔 (weather_check_interval_minutes) の基準時刻。
-- 例: '06:00' + 1440分(1日) なら、毎日JST 06:00を境にチェックする。
-- 未設定 (デフォルト '00:00') なら日付が変わる午前0時が基準になる。

ALTER TABLE card_settings ADD COLUMN weather_check_anchor_time TEXT NOT NULL DEFAULT '00:00';
