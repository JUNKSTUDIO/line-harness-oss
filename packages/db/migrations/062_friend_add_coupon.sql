-- 062_friend_add_coupon.sql
-- 友だち追加時の自動クーポン発行。リファラルリンク (entry_routes) ごとに個別のクーポンを
-- 設定でき、未設定ならアカウント共通の既定クーポン (card_settings) を発行する。

ALTER TABLE card_settings ADD COLUMN friend_add_coupon_template_id TEXT REFERENCES coupon_templates(id) ON DELETE SET NULL;
ALTER TABLE entry_routes ADD COLUMN coupon_template_id TEXT REFERENCES coupon_templates(id) ON DELETE SET NULL;
