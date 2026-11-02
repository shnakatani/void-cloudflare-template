import type { Screen } from "@/test/assert/screen-assertions";

import type { NoteView } from "./notes-page-data";

/** 正規表現の特殊文字を escape する (MDN「正規表現」の Escaping) */
function escapeRegExp(text: string) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * メモの行。行の名前は中身を文書順に並べたもので、行を開くボタンの名前もタイトルの cell もタイトルで始まる。
 * 名前の先頭で引き、開いた詳細の行 (名前は本文) に当たらないようにする
 */
export function noteRow(screen: Screen, note: Pick<NoteView, "title">) {
  return screen.getByRole("row", { name: new RegExp(`^${escapeRegExp(note.title)}`) });
}

/** 行を開いて出した詳細の行 (`NoteBodyDetail`)。名前は本文だけなので、本文を含む本体の行は外れる */
export function noteBodyDetailRow(screen: Screen, note: Pick<NoteView, "body">) {
  return screen.getByRole("row", { name: note.body, exact: true });
}

export function noteExpandTriggerName(note: Pick<NoteView, "title">) {
  return `${note.title}の本文を表示`;
}

export function noteEditTriggerName(note: Pick<NoteView, "title">) {
  return `${note.title}を編集`;
}

export function noteDeleteTriggerName(note: Pick<NoteView, "title">) {
  return `${note.title}を削除`;
}

/** 行の削除トリガー (`NoteActionsCell`)。名前に対象を含むので、確認ダイアログの「削除」とは一致しない */
export function rowDeleteButton(screen: Screen, note: Pick<NoteView, "title">) {
  return screen.getByRole("button", { name: noteDeleteTriggerName(note) });
}
