import type { ReactNode } from "react";
import { ErrorBoundary, useErrorBoundary } from "react-error-boundary";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { announce } from "@/lib/live-announcer";

/**
 * 失敗を伝える読み上げの文。区画に出す見出し (`message`) と同じ文字列にしない。テストの `getByText` が
 * live region と見出しの 2 要素に解決する
 */
export function sectionErrorAnnouncement(message: string): string {
  return `${message}「再試行」で取り直せます`;
}

const SECTION_SLOT = "section-error-boundary";

/**
 * ページの中の区画の描画の失敗を、その区画だけで受ける境界 (ADR-0050)。root の layout の境界 (`AppErrorBoundary`)
 * へ届かせると、区画の外 (検索欄など) ごと全画面のエラー表示に置き換わる。
 * `<Suspense>` は含めない。読み込み中の表示は区画ごとに違うので、使う側が子に並べる。
 * `resetKeys` のどれかが変わると境界は戻る。再試行は子を描き直すだけで、loader を読み直さない。
 * `onCatch` は失敗を捕まえて読み上げた後に呼ぶ
 */
export function SectionErrorBoundary({
  message,
  resetKeys,
  onCatch,
  children,
}: {
  message: string;
  resetKeys?: ReadonlyArray<unknown>;
  onCatch?: (error: unknown) => void;
  children: ReactNode;
}) {
  return (
    // 再試行でボタンが消えると focus が body へ落ちるので、区画の外枠で受ける
    <div data-slot={SECTION_SLOT}>
      <ErrorBoundary
        // react-error-boundary は配列を書き換えないが、型が readonly を受けない。要素ごとに比べるので写してよい
        resetKeys={resetKeys === undefined ? undefined : [...resetKeys]}
        // 読み上げは捕まえた時点で 1 回だけ出す。表示の effect に置くと、開発時の二重実行で 2 回読む
        onError={(error) => {
          announce(sectionErrorAnnouncement(message));
          onCatch?.(error);
        }}
        fallback={<SectionError message={message} />}
      >
        {children}
      </ErrorBoundary>
    </div>
  );
}

/** 区画の失敗の表示。境界を戻す口は `useErrorBoundary` で最も近い境界から取る */
function SectionError({ message }: { message: string }) {
  const { resetBoundary } = useErrorBoundary();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{message}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          onClick={(event) => {
            moveFocusTo(event.currentTarget.closest(`[data-slot="${SECTION_SLOT}"]`));
            resetBoundary();
          }}
        >
          再試行
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * 要素へ focus を移す。focus できない要素には `tabindex="-1"` を付けて移し、focus を失ったら外す
 * (GOV.UK Frontend の `setFocus` と同じ形)。付けたままにすると、中身の click で focus が外枠へ移る
 */
function moveFocusTo(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    // 再試行のボタンは外枠の中にだけ描くので、届かないのは組み方の誤り。focus は body へ落ちる
    console.warn("[SectionErrorBoundary] 再試行のボタンの外枠が見つからない", { element });
    return;
  }
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener(
      "blur",
      () => {
        element.removeAttribute("tabindex");
      },
      { once: true },
    );
  }
  element.focus({ preventScroll: true, focusVisible: false });
}
