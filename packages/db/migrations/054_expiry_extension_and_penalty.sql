-- 054_expiry_extension_and_penalty.sql
-- ① カードのセルフ延長 (期限間近に1回だけ延長できる機能) のON/OFFを管理画面から切替可能にする。
-- ② 完全に期限切れになった場合の挙動を「現状維持」/「ペナルティ」から選べるようにする。
--    ペナルティは grantStamp が「期限切れカードへの久々の付与 (=復活のタイミング)」を検知した
--    瞬間に適用する (現状の「次回付与時に自動でactiveへ戻る」と同じタイミング)。

ALTER TABLE card_settings ADD COLUMN card_expiry_self_extension_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE card_settings ADD COLUMN card_expiry_penalty_type TEXT NOT NULL DEFAULT 'none' CHECK (
  card_expiry_penalty_type IN ('none', 'reset_to_start', 'drop_to_rank', 'drop_one_level', 'reissue')
);
ALTER TABLE card_settings ADD COLUMN card_expiry_penalty_target_rank_id TEXT REFERENCES card_ranks(id) ON DELETE SET NULL;
