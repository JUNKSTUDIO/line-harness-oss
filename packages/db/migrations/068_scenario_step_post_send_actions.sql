-- 068_scenario_step_post_send_actions.sql
-- ステップのフキダシ送信後アクションを拡張する: タグの「付ける/外す」、別シナリオへの移動
-- (現在のシナリオを解除するかどうか選べる)、リッチメニューの切り替え。

-- 既存の on_reach_tag_id と組み合わせて使う。'add'=付ける (既存動作) / 'remove'=外す。
ALTER TABLE scenario_steps ADD COLUMN on_reach_tag_action TEXT NOT NULL DEFAULT 'add' CHECK (on_reach_tag_action IN ('add', 'remove'));

-- 送信後に登録する移動先シナリオ
ALTER TABLE scenario_steps ADD COLUMN on_reach_move_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL;
-- 1なら移動前に現在のシナリオ登録を解除する。0なら現在のシナリオも継続したまま追加登録する。
ALTER TABLE scenario_steps ADD COLUMN on_reach_move_release_current INTEGER NOT NULL DEFAULT 0;

-- 送信後に切り替えるリッチメニュー (グループ単位)
ALTER TABLE scenario_steps ADD COLUMN on_reach_rich_menu_group_id TEXT REFERENCES rich_menu_groups (id) ON DELETE SET NULL;
