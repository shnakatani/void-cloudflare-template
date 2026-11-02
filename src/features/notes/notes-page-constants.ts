/**
 * 一覧のページとダイアログの見出し、`head` の title が共有する値。`head` を通じて worker の program に入るので、
 * 部品と table の型を import しない
 */

/** 一覧ページの名前。一覧の table の名前 (`DataTable` の caption) にも使う */
export const NOTES_PAGE_TITLE = "メモ一覧";

/** 追加ダイアログの見出しと、追加を開いているときの title のページ名 */
export const NOTE_CREATE_DIALOG_TITLE = "メモを追加";

/** 編集ダイアログの見出しと、編集を開いているときの title のページ名 */
export const NOTE_EDIT_DIALOG_TITLE = "メモを編集";

/** 編集の URL の id の行が無いとき (別の user の行を含む) のダイアログの見出し */
export const NOTE_NOT_FOUND_DIALOG_TITLE = "メモが見つかりません";

/** 編集の 1 件を読み込めなかったときのダイアログの見出し */
export const NOTE_LOAD_FAILED_DIALOG_TITLE = "メモを読み込めませんでした";
