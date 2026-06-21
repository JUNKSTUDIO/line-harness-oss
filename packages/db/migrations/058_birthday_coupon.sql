-- 058_birthday_coupon.sql
-- 誕生月クーポンの自動発行設定。発行済みかどうかは年単位でdedupする
-- (誕生日が無い年はそもそも対象外になるので、年が変わるたびにまた発行されてよい)。

ALTER TABLE card_settings ADD COLUMN birthday_coupon_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_settings ADD COLUMN birthday_coupon_template_id TEXT REFERENCES coupon_templates(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS friend_birthday_coupon_log (
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  year             INTEGER NOT NULL,
  issued_coupon_id TEXT REFERENCES user_coupons(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (friend_id, line_account_id, year)
);
