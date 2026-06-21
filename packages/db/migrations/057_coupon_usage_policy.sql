-- 057_coupon_usage_policy.sql
-- クーポンの使用回数制限を「単発 (現状通り)」/「有効期限内は何度でも」から選べるようにする。
-- 後者は status を 'used' に固定する単発モデルと両立しないため、使用ログを別テーブルで持つ。

ALTER TABLE coupon_templates ADD COLUMN usage_policy TEXT NOT NULL DEFAULT 'single_use' CHECK (usage_policy IN ('single_use', 'unlimited_in_period'));

-- 発行時点のテンプレート設定をスナップショットする (テンプレート編集後も発行済みクーポンの挙動が変わらないようにする、既存のname/description/imageと同じ理由)。
ALTER TABLE user_coupons ADD COLUMN usage_policy TEXT NOT NULL DEFAULT 'single_use' CHECK (usage_policy IN ('single_use', 'unlimited_in_period'));

CREATE TABLE IF NOT EXISTS user_coupon_redemptions (
  id                  TEXT PRIMARY KEY,
  user_coupon_id      TEXT NOT NULL REFERENCES user_coupons(id) ON DELETE CASCADE,
  redeemed_by_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  redeemed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_user_coupon_redemptions_coupon ON user_coupon_redemptions (user_coupon_id, redeemed_at);
