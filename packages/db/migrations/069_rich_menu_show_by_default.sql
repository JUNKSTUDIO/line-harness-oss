-- 069_rich_menu_show_by_default.sql
-- リッチメニューを「トーク画面を開いた時に開いた状態で表示する」かどうかの設定。
-- LINE richmenu の `selected` プロパティに相当する (true=展開済みで表示 / false=メニューバーに折りたたみ)。
-- 既存挙動 (常に折りたたみ) を保つため既定は 0。

ALTER TABLE rich_menu_groups ADD COLUMN show_by_default INTEGER NOT NULL DEFAULT 0;
