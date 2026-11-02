import { useRouter } from "@void/react";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { finalFocusToOpener } from "@/lib/dialog-final-focus";
import { announce } from "@/lib/live-announcer";
import { toastMutationError } from "@/lib/mutation-error";
import { PENDING_DISPLAY_DELAY_MS } from "@/lib/pending-display";
import { startVisit } from "@/lib/start-visit";

/** 読み込み中の遷移が開こうとしているダイアログ。読み込みが続くと、ダイアログの形の読み込み中を出す */
export type PendingQueryDialog = {
  /** 行き先のダイアログの同一性。行き先が替わったら待ち直す */
  readonly key: string;
  /** 行き先のダイアログの見出し */
  readonly title: string;
  /** 閉じたときに focus を戻す開いた元の名前 (`dialogOpenerProps`)。決められなければ null */
  readonly openerId: string | null;
};

type QueryDialogProps<TDialog> = {
  /** loader の props の、開いているダイアログ。閉じていれば null */
  dialog: TDialog | null;
  /** ダイアログの同一性 (種類と値の id)。替わったら中身を作り直し、title を読み上げる */
  dialogKey: (dialog: TDialog) => string;
  /** 読み込み中の遷移が開こうとしているダイアログ。`useNavigation()` の行き先から導く */
  pending: PendingQueryDialog | null;
  /** 閉じる操作 (キャンセル、Escape、外側、X) で移る URL。一覧の条件を保った URL を渡す */
  closeHref: string;
  /** 保存の Action の間 true。閉じる操作を止める。閉じる遷移が保存の送信を取り消すため (ADR-0056) */
  blocksClose: boolean;
  /** 閉じる遷移を始める直前に呼ぶ。ページのほかの遷移の待ちを捨てる */
  onClose?: () => void;
  /** ページの title。ダイアログが開閉で替わったら読み上げる */
  title: string;
  renderDialog: (dialog: TDialog) => ReactNode;
};

/** 描いている中身。読み込み中は loader の値を持たない */
type Shown<TDialog> =
  | { readonly kind: "dialog"; readonly key: string; readonly dialog: TDialog }
  | { readonly kind: "pending"; readonly key: string; readonly pending: PendingQueryDialog };

/**
 * 一覧のページの query で開くダイアログの Root (ADR-0056)。Root は開閉をまたいで描いたまま残し、`open` を props から導く。
 *
 * - 閉じる操作は `closeHref` への遷移にする。props のダイアログが閉じた後も、直前の中身を閉じ終わるまで描く
 * - 中身は `dialogKey` で作り直す。開いたまま別の値へ移ったとき、打ち始めた form を前の値のまま残さない
 * - ダイアログの開閉で `title` を読み上げる。query だけの遷移は遷移の読み上げの部品 (ADR-0049) が読まない
 * - 行き先がダイアログの遷移が `PENDING_DISPLAY_DELAY_MS` を超えたら、ダイアログの形の読み込み中を出す。読み込み中は読み上げない
 */
export function QueryDialog<TDialog>({
  dialog,
  dialogKey,
  pending,
  closeHref,
  blocksClose,
  onClose,
  title,
  renderDialog,
}: QueryDialogProps<TDialog>) {
  const router = useRouter();
  // 開いているダイアログがあれば、その遷移の読み込み中は出さない (読み終えると中身が替わる)
  const revealedPending = useRevealedPending(dialog === null ? pending : null);
  const shown: Shown<TDialog> | null =
    dialog !== null
      ? { kind: "dialog", key: `dialog:${dialogKey(dialog)}`, dialog }
      : revealedPending !== null
        ? { kind: "pending", key: `pending:${revealedPending.key}`, pending: revealedPending }
        : null;

  // 閉じた後も、直前に描いていた中身を閉じ終わるまで描く。中身を外すと Popup が閉じるアニメーションを流さずに消える。
  // 閉じ終わりは Base UI が onOpenChangeComplete で知らせる (ADR-0056「閉じる見せ方」)。prop の変化は描画中に導く
  // (React docs「Adjusting some state when a prop changes」)
  const [closing, setClosing] = useState<Shown<TDialog> | null>(null);
  const [previous, setPrevious] = useState(shown);
  if (!isSameShown(previous, shown)) {
    setPrevious(shown);
    if (shown !== null) {
      setClosing(null);
    } else if (previous !== null) {
      setClosing(previous);
    }
  }
  const rendered = shown ?? closing;

  // 直前に読んだダイアログは ref に持ち、初期表示は読まない (ADR-0027 と同じ形)
  const announcedKey = dialog === null ? null : dialogKey(dialog);
  const lastAnnouncedKey = useRef(announcedKey);
  const announceTitle = useEffectEvent(() => {
    announce(title);
  });
  useEffect(() => {
    if (lastAnnouncedKey.current === announcedKey) {
      return;
    }
    lastAnnouncedKey.current = announcedKey;
    announceTitle();
  }, [announcedKey]);

  const handleOpenChange: NonNullable<ComponentProps<typeof Dialog>["onOpenChange"]> = (
    open,
    details,
  ) => {
    if (open) {
      return;
    }
    if (blocksClose) {
      details.cancel();
      return;
    }
    // 新しい props でダイアログが閉じる。同じ一覧に戻るので scroll を保つ。クロスフェードにしない。Overlay が
    // Base UI の閉じ方より長く残る (ADR-0056「閉じる見せ方」)。読み込み中に閉じると、この遷移が読み込みを取り消す (ADR-0017)
    onClose?.();
    startVisit(router, closeHref, { preserveScroll: true, viewTransition: false });
  };

  return (
    <Dialog
      open={shown !== null}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setClosing(null);
        }
      }}
    >
      {rendered !== null && (
        <Fragment key={rendered.key}>
          {rendered.kind === "dialog" ? (
            renderDialog(rendered.dialog)
          ) : (
            <StatusDialogContent
              status="pending"
              title={rendered.pending.title}
              openerId={rendered.pending.openerId}
            />
          )}
        </Fragment>
      )}
    </Dialog>
  );
}

function isSameShown<TDialog>(a: Shown<TDialog> | null, b: Shown<TDialog> | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind === "dialog" && b.kind === "dialog") {
    return a.dialog === b.dialog;
  }
  if (a.kind === "pending" && b.kind === "pending") {
    return a.pending === b.pending;
  }
  return false;
}

/**
 * `pending` が同じ行き先のまま `PENDING_DISPLAY_DELAY_MS` 続いたら、その値を返す。行き先が替わるか無くなったら、
 * 返していた値を捨てて待ち直す
 */
function useRevealedPending(pending: PendingQueryDialog | null): PendingQueryDialog | null {
  const pendingKey = pending?.key ?? null;
  const [revealed, setRevealed] = useState<PendingQueryDialog | null>(null);
  if (revealed !== null && revealed.key !== pendingKey) {
    setRevealed(null);
  }
  const reveal = useEffectEvent(() => {
    setRevealed(pending);
  });
  useEffect(() => {
    if (pendingKey === null) {
      return;
    }
    const timer = setTimeout(reveal, PENDING_DISPLAY_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pendingKey]);
  return revealed;
}

/** 開いたダイアログの代わりに出す状態。loader が開く 1 件を返せないとき (`not-found`、`load-failed`) と、読み込み中 */
type DialogStatus = "pending" | "not-found" | "load-failed";

/**
 * 開いたダイアログのフォームを出せない間に、同じ Root の中へ描く中身。閉じると `openerId` の開いた元へ focus を戻す
 * (`finalFocusToOpener`)。`load-failed` の再試行は loader を読み直し、例外の文言は出さない
 */
export function StatusDialogContent({
  status,
  title,
  openerId,
}: {
  status: DialogStatus;
  /** 開こうとしたダイアログの見出しか、状態の見出し (「<対象>が見つかりません」) */
  title: string;
  openerId: string | null;
}) {
  return (
    <DialogContent finalFocus={finalFocusToOpener(openerId)}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{statusDescription(status)}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose>
        {status === "load-failed" && <RetryButton />}
      </DialogFooter>
    </DialogContent>
  );
}

function statusDescription(status: DialogStatus): string {
  switch (status) {
    case "pending":
      return "読み込み中";
    case "not-found":
      return "削除されたか、URL が誤っています。";
    case "load-failed":
      return "時間をおいて再試行してください。";
    default: {
      const unhandled: never = status;
      throw new Error(`unhandled DialogStatus: ${String(unhandled)}`);
    }
  }
}

/** loader を読み直す。クロスフェードにしない。失敗の表示と読み直した画面が重なる (ADR-0058) */
function RetryButton() {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        router.refresh({ viewTransition: false }).catch((error: unknown) => {
          toastMutationError(error);
        });
      }}
    >
      再試行
    </Button>
  );
}
