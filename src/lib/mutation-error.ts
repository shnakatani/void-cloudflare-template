import { toast } from "@/components/ui/toast";

/** mutation 失敗時にユーザーへ出す固定文言。原因ではなく次に取れる行動だけを伝える。 */
export const MUTATION_ERROR_FALLBACK_MESSAGE =
  "操作に失敗しました。時間をおいて再試行してください。";

/**
 * mutation の失敗で toast に出す文言を組み立てる。
 *
 * server から返る Error の文言はユーザーが取れる行動を含まないため、そのまま render せず固定文言へ丸める。
 * infra / network 由来の raw error ("Failed to fetch" 等の英語技術文言) も同じ扱いになる。
 *
 * raw error は observability のため console.warn に残す (fail-closed)。
 *
 * ユーザー向けの文言を持つエラーを導入するときは、その型の分岐をここへ足して
 * `error.message` を返す。分岐を足す場所をここ 1 箇所に
 * 閉じるために、呼び出し側は toast へ渡す文言をこの関数からのみ受け取る。
 */
export function curateMutationErrorMessage(error: unknown): string {
  console.warn("[mutation] failed", { error });
  return MUTATION_ERROR_FALLBACK_MESSAGE;
}

/**
 * mutation の失敗を toast に出す。`usePageAction` の `run` が、`action()` の `ok: false` と throw をこれで出す。
 *
 * 「curate を通した文言だけを toast に出す」という配線を消費側ごとに書くと、
 * 1 箇所が `error.message` を直接渡す形へ戻っても他が正しいままで気付けない。
 * 失敗を toast に出す経路を足すときは、これを通す。
 */
export function toastMutationError(error: unknown): void {
  toast.add({ type: "error", title: curateMutationErrorMessage(error) });
}
