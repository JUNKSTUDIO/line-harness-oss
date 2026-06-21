-- 056_friend_anniversary_and_birthday.sql
-- ① 友だち登録記念日ボーナス: 各お客様の「友だち追加日」の日付 (毎月) にだけ適用される
--    個別のポイント倍率。既存の point_multiplier_rules には乗らず (アカウント全体のルールという
--    前提と合わないため)、card_settings の専用フィールド + grantStamp 側での都度計算で実現する。
-- ② 誕生日 (年月日) — お客様がLIFFで自己登録する。年は現状未使用だが将来の拡張のため保持する。

ALTER TABLE card_settings ADD COLUMN friend_anniversary_multiplier_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_settings ADD COLUMN friend_anniversary_multiplier_value REAL NOT NULL DEFAULT 1.5;
ALTER TABLE card_settings ADD COLUMN friend_anniversary_reminder_message TEXT;

ALTER TABLE friends ADD COLUMN birthday_year INTEGER;
ALTER TABLE friends ADD COLUMN birthday_month INTEGER CHECK (birthday_month IS NULL OR (birthday_month BETWEEN 1 AND 12));
ALTER TABLE friends ADD COLUMN birthday_day INTEGER CHECK (birthday_day IS NULL OR (birthday_day BETWEEN 1 AND 31));

-- 記念日リマインドの「今月すでに送ったか」を友だち×アカウント単位で管理する (friendsテーブルを汚さない)。
CREATE TABLE IF NOT EXISTS friend_anniversary_reminders (
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  last_sent_month TEXT NOT NULL,
  PRIMARY KEY (friend_id, line_account_id)
);
