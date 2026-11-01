import { toNoteView } from "./notes-page-data";
import { NOTE, OTHER_NOTE, UPDATED_NOTE } from "./schema.test-helpers";

export const NOTE_VIEW = toNoteView(NOTE);
export const OTHER_NOTE_VIEW = toNoteView(OTHER_NOTE);
/** 作成日時と更新日時が違う 1 件。2 つの日時の列の取り違えを見る */
export const UPDATED_NOTE_VIEW = toNoteView(UPDATED_NOTE);
