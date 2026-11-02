import type { DeleteTarget } from "@/components/parts/delete-confirm-dialog";
import { createAlertDialogHandle } from "@/components/ui/alert-dialog";

import type { Note } from "./schema";

/**
 * 削除確認ダイアログの detached trigger (一覧の各行、`note-cells.tsx`) と、Root (`DeleteConfirmDialog`、ページが描く)
 * を結ぶ handle。Base UI が求めるのは Trigger と Root が同じ handle を持つことだけなので、module 定数として置く。
 * ページの確定の Action も、確定操作の直後の `close()` にこれを使う (ADR-0017)
 */
export const noteDeleteDialogHandle = createAlertDialogHandle<DeleteTarget<Note["id"]>>();
