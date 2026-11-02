import type { RefObject } from "react";

import { moveFocusToPageHeading } from "@/lib/focus-page-heading";

import type { Note } from "./schema";

/** 行の編集リンクに付ける属性。編集ダイアログを閉じたときに、その行のリンクを探す */
const NOTE_EDIT_LINK_ATTRIBUTE = "data-note-edit-link";

/** 追加のリンクに付ける属性。追加ダイアログを閉じたときに、そのリンクを探す */
const NOTE_CREATE_LINK_ATTRIBUTE = "data-note-create-link";

export function noteEditLinkProps(noteId: Note["id"]): { "data-note-edit-link": string } {
  return { [NOTE_EDIT_LINK_ATTRIBUTE]: String(noteId) };
}

export function noteCreateLinkProps(): { "data-note-create-link": string } {
  return { [NOTE_CREATE_LINK_ATTRIBUTE]: "" };
}

export function findNoteEditLink(noteId: Note["id"]): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${NOTE_EDIT_LINK_ATTRIBUTE}="${noteId}"]`);
}

export function findNoteCreateLink(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${NOTE_CREATE_LINK_ATTRIBUTE}]`);
}

/**
 * 追加のリンクを、読むたびに DOM から探す ref。`ButtonLink` は ref を受けないので、`DeleteConfirmDialog` の
 * `fallbackFocusRef` にはこの形で渡す
 */
export const noteCreateLinkRef: RefObject<HTMLElement | null> = {
  get current() {
    return findNoteCreateLink();
  },
};

/**
 * ダイアログを閉じたときの focus の移し先 (`DialogContent` の `finalFocus`)。開いた元のリンクを探して返す。
 * 開いた元のリンクが無いとき (一覧を読めなかった、行が消えた) は見出しへ移す。Base UI に要素を返すと枠を出さない
 * 指定を渡せないので、見出しへは自分で移して false を返す
 */
export function noteDialogFinalFocus(find: () => HTMLElement | null): () => HTMLElement | false {
  return () => {
    const target = find();
    if (target !== null) {
      return target;
    }
    moveFocusToPageHeading();
    return false;
  };
}
