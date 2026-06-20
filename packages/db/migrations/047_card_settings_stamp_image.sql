-- 047_card_settings_stamp_image.sql
-- スタンプが押されたマスに表示する画像を管理画面からアップロードできるようにする。
-- NULL の場合は LIFF 側で「済」のテキストスタンプにフォールバックする。

ALTER TABLE card_settings ADD COLUMN stamp_image_url TEXT;
