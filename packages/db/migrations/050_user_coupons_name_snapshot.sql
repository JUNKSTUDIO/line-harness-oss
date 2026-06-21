-- 050_user_coupons_name_snapshot.sql
-- クーポンテンプレートの名前を後から編集しても、既に発行済みのクーポンの表示が
-- 遡って変わってしまわないように、発行時点の名前をスナップショットしておく。
-- NULL (このマイグレーション以前に発行された行) は表示時に coupon_templates.name へ
-- フォールバックする。

ALTER TABLE user_coupons ADD COLUMN coupon_name_at_issuance TEXT;
