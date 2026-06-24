-- 067_scenario_step_rewards_and_schedule.sql
-- ステップ到達時のスタンプ/クーポン付与、および relative モードでの
-- ステップ別「送信時刻指定」「ランダム早め配信」を追加する。

-- 到達時アクション (既存の on_reach_tag_id と同じ並びで追加)
ALTER TABLE scenario_steps ADD COLUMN on_reach_stamp_count INTEGER;
ALTER TABLE scenario_steps ADD COLUMN on_reach_coupon_template_id TEXT REFERENCES coupon_templates (id) ON DELETE SET NULL;

-- relative モード限定: 単位「日」を選んだ時に「前ステップ配信時刻からNカレンダー日後の指定時刻」に
-- 配信したい場合の時刻 ("HH:MM")。NULLなら従来通りの純粋な経過分数 (delay_minutes) のまま。
ALTER TABLE scenario_steps ADD COLUMN pin_delivery_time TEXT;

-- ステップ単位で「常に6〜14分早める」ジッターを使うか。falseなら既存の±5分対称ジッターのまま。
ALTER TABLE scenario_steps ADD COLUMN early_jitter_enabled INTEGER NOT NULL DEFAULT 0;
