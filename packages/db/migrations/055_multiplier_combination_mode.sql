-- 055_multiplier_combination_mode.sql
-- 複数のポイント倍率ルールが同時にマッチした場合の合算方式を管理画面から選べるようにする。
--   highest_priority_only (既定・従来通り): priorityが最大の1件のみ適用
--   multiply_all: マッチした全ルールの倍率を掛け合わせる (例: 2倍 × 1.5倍 = 3倍)
--   sum_all: マッチした全ルールの倍率を足し合わせる (例: 2倍 + 1.5倍 = 3.5倍)

ALTER TABLE card_settings ADD COLUMN multiplier_combination_mode TEXT NOT NULL DEFAULT 'highest_priority_only' CHECK (
  multiplier_combination_mode IN ('highest_priority_only', 'multiply_all', 'sum_all')
);
