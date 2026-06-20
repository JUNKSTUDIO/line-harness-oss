// ランクアップ時のリッチメニュー自動切替。
// event-bus.ts の switch_rich_menu アクションと同じ LineClient.linkRichMenuToUser を使う。
// card_ranks.rich_menu_group_id (内部の rich_menu_groups への参照) を、実際にLINEへ送る
// richMenuId (group の default ページの line_richmenu_id) に解決してから呼び出す。

import { LineClient } from '@line-crm/line-sdk';
import { getCardRankById, getRichMenuGroupWithPages, getFriendById, type LineAccount } from '@line-crm/db';

export async function applyRankUpRichMenu(
  db: D1Database,
  account: LineAccount,
  friendId: string,
  newRankId: string | null,
): Promise<void> {
  if (!newRankId) return;
  const rank = await getCardRankById(db, newRankId);
  if (!rank?.rich_menu_group_id) return;

  const group = await getRichMenuGroupWithPages(db, rank.rich_menu_group_id);
  if (!group || group.pages.length === 0) return;
  const page = group.pages.find((p) => p.id === group.default_page_id) ?? group.pages[0];
  if (!page.line_richmenu_id) return; // まだLINE側に公開されていないページ

  const friend = await getFriendById(db, friendId);
  if (!friend) return;

  try {
    const client = new LineClient(account.channel_access_token);
    await client.linkRichMenuToUser(friend.line_user_id, page.line_richmenu_id);
  } catch (err) {
    // リッチメニュー切替の失敗はスタンプ付与自体を失敗させない (ベストエフォート)
    console.error('[rank-rich-menu] linkRichMenuToUser failed', err);
  }
}
