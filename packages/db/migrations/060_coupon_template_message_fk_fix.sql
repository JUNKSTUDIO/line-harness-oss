-- 060_coupon_template_message_fk_fix.sql
-- バグ修正: coupon_templates.message_template_id が message_templates(id) を参照していたが、
-- 管理画面の「テンプレート」(リッチメッセージ作成UI、Flex JSON編集+プレビュー対応) は
-- 実際には templates テーブル (routes/templates.ts, /api/templates) を使っている。
-- message_templates は紹介リンク/フォーム特典専用の別system (routes/message-templates.ts,
-- /api/message-templates) で、汎用のリッチメッセージ作成UIを持たない。
-- そのため coupon_templates.message_template_id に templates.id を指定しても外部キー制約で
-- 必ず失敗していた (= この機能は実質使えない状態だった)。参照先を templates(id) に修正する。
--
-- SQLiteはALTERでFK参照先だけを変更できないため、テーブルを再作成する
-- (migration 053の point_multiplier_rules と同じ手順)。

CREATE TABLE coupon_templates_new (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  validity_type         TEXT NOT NULL DEFAULT 'relative_days' CHECK (validity_type IN ('relative_days', 'absolute_date')),
  validity_days         INTEGER,
  absolute_expires_at   TEXT,
  message_template_id   TEXT REFERENCES templates(id) ON DELETE SET NULL,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  image_url             TEXT,
  usage_policy          TEXT NOT NULL DEFAULT 'single_use' CHECK (usage_policy IN ('single_use', 'unlimited_in_period')),
  CHECK (
    (validity_type = 'relative_days' AND validity_days IS NOT NULL) OR
    (validity_type = 'absolute_date' AND absolute_expires_at IS NOT NULL)
  )
);

INSERT INTO coupon_templates_new (
  id, line_account_id, name, description, validity_type, validity_days, absolute_expires_at,
  message_template_id, is_active, created_at, updated_at, image_url, usage_policy
)
SELECT
  id, line_account_id, name, description, validity_type, validity_days, absolute_expires_at,
  NULL, -- 既存の message_template_id は (存在していれば) message_templates 由来で templates には無いため引き継がない
  is_active, created_at, updated_at, image_url, usage_policy
FROM coupon_templates;

DROP TABLE coupon_templates;
ALTER TABLE coupon_templates_new RENAME TO coupon_templates;

CREATE INDEX IF NOT EXISTS idx_coupon_templates_account ON coupon_templates (line_account_id, is_active);
