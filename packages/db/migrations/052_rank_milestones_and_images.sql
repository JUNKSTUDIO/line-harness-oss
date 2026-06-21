-- 052_rank_milestones_and_images.sql
-- ランク内マイルストーン報酬 (例: シルバーランク10個中5個で中間クーポン) と、
-- ランク/クーポンの画像設定、カードバッジの表示レイアウト切替に対応する。

ALTER TABLE card_ranks ADD COLUMN image_url TEXT;
ALTER TABLE card_settings ADD COLUMN rank_badge_layout TEXT NOT NULL DEFAULT 'split' CHECK (rank_badge_layout IN ('split', 'background'));
ALTER TABLE coupon_templates ADD COLUMN image_url TEXT;

-- クーポンテンプレートの説明・画像も、発行時点でスナップショットする
-- (前回のmigration 050で name は対応済み。description/imageも同じ理由で追従)。
ALTER TABLE user_coupons ADD COLUMN coupon_description_at_issuance TEXT;
ALTER TABLE user_coupons ADD COLUMN coupon_image_url_at_issuance TEXT;

-- ============================================================
-- card_rank_milestones: ランク内の中間到達報酬 (1ランクに複数可)
-- ============================================================
CREATE TABLE IF NOT EXISTS card_rank_milestones (
  id                 TEXT PRIMARY KEY,
  card_rank_id       TEXT NOT NULL REFERENCES card_ranks(id) ON DELETE CASCADE,
  stamp_threshold    REAL NOT NULL CHECK (stamp_threshold > 0),
  coupon_template_id TEXT NOT NULL REFERENCES coupon_templates(id) ON DELETE CASCADE,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (card_rank_id, stamp_threshold)
);

CREATE INDEX IF NOT EXISTS idx_card_rank_milestones_rank ON card_rank_milestones (card_rank_id, stamp_threshold);

-- ============================================================
-- user_card_milestone_coupons: どのユーザーがどのマイルストーンを既に獲得済みか
-- (二重発行防止 + LIFF側で「獲得済み/未獲得」の判定に使う)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_card_milestone_coupons (
  id                TEXT PRIMARY KEY,
  user_card_id      TEXT NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  milestone_id      TEXT NOT NULL REFERENCES card_rank_milestones(id) ON DELETE CASCADE,
  issued_coupon_id  TEXT REFERENCES user_coupons(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (user_card_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_user_card_milestone_coupons_card ON user_card_milestone_coupons (user_card_id);
