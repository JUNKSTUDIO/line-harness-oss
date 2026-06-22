-- 061_remote_grant_permission.sql
-- 管理画面から特定の友だちへ直接ポイント付与・クーポン発行する機能 (QRコード読み取り不要) の
-- 実行権限しきい値。staff.role (owner > admin > staff) がこの値以上なら実行できる。

ALTER TABLE card_settings ADD COLUMN remote_grant_min_role TEXT NOT NULL DEFAULT 'owner' CHECK (
  remote_grant_min_role IN ('owner', 'admin', 'staff')
);
