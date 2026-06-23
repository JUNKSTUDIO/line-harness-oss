-- 064_business_calendar.sql
-- 営業日カレンダー (iCal連携) + クーポン/ショップカード有効期限のカレンダー表示設定。

ALTER TABLE card_settings ADD COLUMN calendar_ical_url TEXT;
ALTER TABLE card_settings ADD COLUMN calendar_months_ahead INTEGER NOT NULL DEFAULT 3;
ALTER TABLE card_settings ADD COLUMN calendar_show_coupon_expiry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_settings ADD COLUMN calendar_show_card_expiry INTEGER NOT NULL DEFAULT 0;
