-- 063_friend_add_coupon_log.sql
-- 友だち追加時クーポンの発行済みログ。ブロック→ブロック解除で follow イベントが
-- 再度発火しても、同じ友だちには二重発行しない (誕生月クーポンと違い年単位ではなく、
-- そのアカウントに対して一度発行したら以後ずっと発行しない)。

CREATE TABLE IF NOT EXISTS friend_add_coupon_log (
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  issued_coupon_id TEXT REFERENCES user_coupons(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (friend_id, line_account_id)
);
