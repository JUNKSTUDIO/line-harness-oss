-- 046_stamp_card_coupon_system.sql
-- ランクアップ式スタンプカード + クーポン管理 + 条件付きポイント倍率 +
-- 「期限1週間セルフ延長(1回限定)」機能。
--
-- 要件定義書「LINE Harnessスタンプカード・クーポンシステム 統合要件定義書」を
-- D1 (SQLite) の既存スキーマ規約 (TEXT/UUID PK, JST timestamps, CHECK制約による
-- enum) に合わせて実装。MySQL前提の要件書から以下を読み替えている:
--   - AUTO_INCREMENT  → アプリ側 crypto.randomUUID() を PK に用いる既存方式
--   - ENUM型          → TEXT + CHECK制約
--   - BOOLEAN         → INTEGER (0/1)
--   - 複合インデックス → 既存の idx_xxx 命名規則
--
-- 「1回限定の1週間セルフ延長フラグ」は user_cards / user_coupons の両方に
-- expiration_extended INTEGER で持つ。延長APIはこのフラグを条件付き原子的
-- UPDATE (WHERE expiration_extended = 0) でチェックするため、二重延長は
-- DBレベルで防止される (詳細は services/card-coupon-extend.ts)。

-- ============================================================
-- card_settings: 店舗ごとのスタンプカード基本設定 (1 line_account = 1行)
-- ============================================================
CREATE TABLE IF NOT EXISTS card_settings (
  line_account_id            TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  stamp_rule_type            TEXT NOT NULL DEFAULT 'per_visit' CHECK (stamp_rule_type IN ('per_visit', 'per_amount')),
  amount_per_stamp           INTEGER,                          -- per_amount時: 何円で1pt (例: 1000)
  signup_bonus_stamps        INTEGER NOT NULL DEFAULT 0,       -- 発行時ボーナス
  rank_enabled               INTEGER NOT NULL DEFAULT 0,       -- ランクアップ機能 ON/OFF
  flat_goal_stamps           INTEGER,                          -- rank_enabled=0時の単一ゴール
  card_expiry_months         INTEGER,                          -- 最終利用日から○ヶ月 (NULL = 無期限)
  default_coupon_validity_days INTEGER NOT NULL DEFAULT 30,    -- coupon_templates未指定時の既定有効期限
  reminder_days_before        INTEGER NOT NULL DEFAULT 3,      -- 期限前リマインドのタイミング (残り○日)
  reservation_url             TEXT,                            -- 外部予約システムURL (NULLなら社内LIFF予約に誘導)
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (stamp_rule_type != 'per_amount' OR amount_per_stamp IS NOT NULL)
);

-- ============================================================
-- coupon_templates: クーポンマスタ (ランク報酬 or 単独キャンペーン)
-- card_ranks.reward_coupon_template_id から参照されるため先に定義する。
-- ============================================================
CREATE TABLE IF NOT EXISTS coupon_templates (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  validity_type         TEXT NOT NULL DEFAULT 'relative_days' CHECK (validity_type IN ('relative_days', 'absolute_date')),
  validity_days         INTEGER,                        -- validity_type='relative_days'
  absolute_expires_at   TEXT,                           -- validity_type='absolute_date'
  message_template_id   TEXT REFERENCES message_templates(id) ON DELETE SET NULL,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (
    (validity_type = 'relative_days' AND validity_days IS NOT NULL) OR
    (validity_type = 'absolute_date' AND absolute_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_coupon_templates_account ON coupon_templates (line_account_id, is_active);

-- ============================================================
-- card_ranks: ランク設定 (ブロンズ/シルバー/...). rank_enabled=0の店舗は未使用。
-- ============================================================
CREATE TABLE IF NOT EXISTS card_ranks (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,                 -- 例: "ブロンズ"
  rank_order              INTEGER NOT NULL,              -- 0始まり昇順 (0=最初のランク)
  max_stamps              INTEGER NOT NULL CHECK (max_stamps > 0),
  reward_coupon_template_id TEXT REFERENCES coupon_templates(id) ON DELETE SET NULL,
  rich_menu_group_id      TEXT REFERENCES rich_menu_groups(id) ON DELETE SET NULL, -- 到達時に切替えるリッチメニュー
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, rank_order)
);

CREATE INDEX IF NOT EXISTS idx_card_ranks_account_order ON card_ranks (line_account_id, rank_order);

-- ============================================================
-- point_multiplier_rules: 条件付きポイント倍率 (雨の日2倍, ハッピーアワー等)
-- ============================================================
CREATE TABLE IF NOT EXISTS point_multiplier_rules (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,                      -- 例: "雨の日2倍"
  multiplier        REAL NOT NULL CHECK (multiplier > 0),
  condition_type    TEXT NOT NULL CHECK (condition_type IN ('manual', 'weekday', 'time_range', 'period', 'weather')),
  weekday           INTEGER CHECK (weekday BETWEEN 0 AND 6),   -- condition_type='weekday' (0=日曜)
  time_start        TEXT,                                      -- condition_type='time_range' "HH:MM"
  time_end          TEXT,
  starts_at         TEXT,                                      -- condition_type='period' (JST, "YYYY-MM-DD" or datetime)
  ends_at           TEXT,
  weather_condition TEXT CHECK (weather_condition IN ('rain', 'snow')), -- condition_type='weather'
  is_active         INTEGER NOT NULL DEFAULT 1,                -- 当日の手動ON/OFFスイッチ (天候/manual型はこれが実質トグル)
  priority          INTEGER NOT NULL DEFAULT 0,                -- 複数同時成立時、最大priorityの1件のみ採用 (乗算スタックはしない)
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_point_multiplier_rules_account_active ON point_multiplier_rules (line_account_id, is_active);

-- ============================================================
-- user_cards: 友だちごとのスタンプカード状態 (1 friend × 1 line_account = 1行)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_cards (
  id                      TEXT PRIMARY KEY,
  friend_id               TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  current_rank_id         TEXT REFERENCES card_ranks(id) ON DELETE SET NULL, -- rank_enabled=0ならNULL
  stamp_count             INTEGER NOT NULL DEFAULT 0,    -- 現ランク内の進捗 (ランクアップ時0にリセット)
  total_stamp_count       INTEGER NOT NULL DEFAULT 0,    -- 通算スタンプ数 (統計用、リセットしない)
  last_stamped_at         TEXT,                          -- UTC ISO8601。card_expiry_monthsの起点
  expires_at              TEXT,                          -- last_stamped_at + card_expiry_months (NULL=無期限)
  expiration_extended     INTEGER NOT NULL DEFAULT 0,    -- (要件⑤) 1回限定セルフ延長フラグ
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  expiry_reminder_sent_at TEXT,                          -- 期限前リマインド済みマーカー (重複送信防止)
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (friend_id, line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cards_friend ON user_cards (friend_id);
-- 期限前リマインドバッチ / 期限切れ処理が叩く複合インデックス
CREATE INDEX IF NOT EXISTS idx_user_cards_status_expires ON user_cards (status, expires_at);

-- ============================================================
-- stamp_logs: スタンプ付与履歴 (倍率適用の証跡、スタッフ操作ログ)
-- ============================================================
CREATE TABLE IF NOT EXISTS stamp_logs (
  id                  TEXT PRIMARY KEY,
  user_card_id        TEXT NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  source              TEXT NOT NULL CHECK (source IN ('visit', 'amount', 'signup_bonus', 'manual')),
  amount_yen          INTEGER,                          -- source='amount'時の利用金額
  base_points         INTEGER NOT NULL,                 -- 倍率適用前のpt
  multiplier_applied  REAL NOT NULL DEFAULT 1,
  final_points        INTEGER NOT NULL,                 -- 実際に付与されたpt = round(base*multiplier)
  multiplier_rule_id  TEXT REFERENCES point_multiplier_rules(id) ON DELETE SET NULL,
  granted_by_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_stamp_logs_user_card ON stamp_logs (user_card_id, created_at);

-- ============================================================
-- user_coupons: 発行済みクーポン (友だちが実際に持っている1枚)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_coupons (
  id                      TEXT PRIMARY KEY,
  friend_id               TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  coupon_template_id      TEXT NOT NULL REFERENCES coupon_templates(id) ON DELETE CASCADE,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  issued_via              TEXT NOT NULL DEFAULT 'manual' CHECK (issued_via IN ('rank_clear', 'manual', 'campaign')),
  source_user_card_id     TEXT REFERENCES user_cards(id) ON DELETE SET NULL, -- ランク到達発行の場合のみ
  status                  TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired')),
  issued_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at              TEXT NOT NULL,
  used_at                 TEXT,
  used_by_staff_id        TEXT REFERENCES staff(id) ON DELETE SET NULL,      -- 消し込み担当スタッフ
  expiration_extended     INTEGER NOT NULL DEFAULT 0,    -- (要件⑤) 1回限定セルフ延長フラグ
  rescue_count            INTEGER NOT NULL DEFAULT 0,    -- 管理者手動救済の回数 (セルフ延長と異なり複数回可)
  last_rescued_at         TEXT,
  expiry_reminder_sent_at TEXT,                          -- 期限前リマインド済みマーカー
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_user_coupons_friend ON user_coupons (friend_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_template ON user_coupons (coupon_template_id);
-- 期限前リマインド / 期限切れ処理 / 「期限切れクーポン保持者」検索が叩く
CREATE INDEX IF NOT EXISTS idx_user_coupons_status_expires ON user_coupons (status, expires_at);
