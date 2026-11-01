import { useRouter } from "@void/react";
import { useEffect, type ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

import { ActionButton } from "@/components/action/button";
import { FullScreenNotice } from "@/components/parts/centered-card";

/**
 * 本文に出す固定の文言。原因ではなく次に取れる行動だけを伝える
 * (`lib/mutation-error.ts` の `MUTATION_ERROR_FALLBACK_MESSAGE` と対になる意匠)
 */
export const APP_ERROR_MESSAGE = "ページを表示できませんでした。時間をおいて再試行してください。";

const ERROR_TITLE_PREFIX = "エラー: ";

/**
 * 全画面のエラー表示 (ADR-0050)。例外の文言は出さない。production の Void は server の例外の中身を client へ渡さず、
 * 開発中の原因は Void の overlay と console で追う。
 *
 * 出している間は `document.title` の前に「エラー: 」を付け、タブと遷移の読み上げ (ADR-0049) にも失敗を出す。
 * 外れたときは、title が付けたときのままなら戻す。再試行や遷移で Void が書き換えていたら、その値を残す。
 * `error` が変わったら付け直す。遷移の先でも失敗すると、この部品は作り直されずに次の `error` を受ける。
 * 再試行は決着するまで押せない (`ActionButton`)。
 */
export function AppError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => Promise<void> | void;
}) {
  useEffect(() => {
    const pageTitle = document.title;
    const errorTitle = `${ERROR_TITLE_PREFIX}${pageTitle}`;
    document.title = errorTitle;
    return () => {
      if (document.title === errorTitle) {
        document.title = pageTitle;
      }
    };
  }, [error]);

  return (
    <FullScreenNotice title="エラーが発生しました" description={APP_ERROR_MESSAGE}>
      <ActionButton action={onRetry} className="w-full">
        再試行
      </ActionButton>
    </FullScreenNotice>
  );
}

/**
 * 再試行は loader を読み直してから境界を戻す。先に戻すと、失敗したときの props のまま描き直して同じ失敗を繰り返し、
 * 読み直した props が届いても境界は戻らない
 */
function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const router = useRouter();

  async function retry() {
    try {
      await router.refresh();
    } catch (refreshError) {
      // 読み直せなくても境界は戻し、描き直せるかを試す。描き直しも失敗すれば、この表示に戻る
      console.warn("[AppErrorBoundary] 再読み込みに失敗した", { error: refreshError });
    }
    resetErrorBoundary();
  }

  return <AppError error={error} onRetry={retry} />;
}

/**
 * ページの描画の失敗を全画面のエラー表示で受ける境界 (ADR-0050)。root の layout が `<main>` の中身を包む。
 * Void の React の tree は境界を持たないので、無いと描画の失敗で React の root ごと外れる。
 *
 * 別のページへ移ったら戻す。layout は遷移で作り直されないので、戻さないと失敗の表示が次のページに残る。
 * 受けた例外は React が `console.error` に出す (`createRoot` / `hydrateRoot` の既定の `onCaughtError`。Void は渡さない)
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  return (
    <ErrorBoundary FallbackComponent={AppErrorFallback} resetKeys={[path]}>
      {children}
    </ErrorBoundary>
  );
}
