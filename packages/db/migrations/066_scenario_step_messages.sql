-- 066_scenario_step_messages.sql
-- シナリオの1ステップにつき最大5つのフキダシ（LINE公式の1回push上限）を送れるようにする。
-- 既存の scenario_steps.message_type/message_content/template_id は後方互換のためそのまま残し、
-- 今後はこの子テーブルを正として読み書きする（既存カラムはこの移行後は更新しない）。

CREATE TABLE IF NOT EXISTS scenario_step_messages (
  id                TEXT PRIMARY KEY,
  scenario_step_id  TEXT NOT NULL REFERENCES scenario_steps (id) ON DELETE CASCADE,
  order_index       INTEGER NOT NULL,
  message_type      TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content   TEXT NOT NULL,
  template_id       TEXT REFERENCES templates (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (scenario_step_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_scenario_step_messages_step ON scenario_step_messages (scenario_step_id);

-- 既存の全ステップを「1ステップ1フキダシ (order_index=0)」として移行する。
INSERT INTO scenario_step_messages (id, scenario_step_id, order_index, message_type, message_content, template_id, created_at)
SELECT lower(hex(randomblob(16))), id, 0, message_type, message_content, template_id, created_at
FROM scenario_steps;
