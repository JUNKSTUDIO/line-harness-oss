-- 048_card_settings_weather_location.sql
-- 天候連動ポイント倍率ルールの自動判定に使う店舗の位置情報。
-- weather_last_checked_at は外部天気APIの呼び出し頻度を間引くための自己スロットル用マーカー。

ALTER TABLE card_settings ADD COLUMN shop_latitude REAL;
ALTER TABLE card_settings ADD COLUMN shop_longitude REAL;
ALTER TABLE card_settings ADD COLUMN weather_last_checked_at TEXT;
