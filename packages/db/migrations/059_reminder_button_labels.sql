-- 059_reminder_button_labels.sql
-- 期限間近のお知らせメッセージ内のボタン文言・補足テキストを管理画面から編集できるようにする。
-- NULL の場合は従来通りのハードコードされた文言にフォールバックする。

ALTER TABLE card_settings ADD COLUMN reminder_reservation_button_label TEXT;
ALTER TABLE card_settings ADD COLUMN reminder_reservation_helper_text TEXT;
ALTER TABLE card_settings ADD COLUMN reminder_extend_button_label TEXT;
