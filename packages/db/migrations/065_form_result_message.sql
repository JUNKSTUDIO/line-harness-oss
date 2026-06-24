-- 065_form_result_message.sql
-- アンケート (forms) の誘導テンプレート重複防止 + 送信後の結果メッセージ (診断結果) の
-- タイトル・フッター文言をアンケートごとにカスタマイズできるようにする。

ALTER TABLE forms ADD COLUMN guide_template_id TEXT REFERENCES templates (id) ON DELETE SET NULL;
ALTER TABLE forms ADD COLUMN result_title TEXT;
ALTER TABLE forms ADD COLUMN result_footer_text TEXT;
