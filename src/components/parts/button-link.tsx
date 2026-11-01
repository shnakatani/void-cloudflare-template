import { Link } from "@void/react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";

import { buttonVariants } from "@/components/ui/button";

import { PendingLabel } from "./pending-label";

type ButtonLinkProps = Omit<
  ComponentProps<typeof Link>,
  "className" | "disabled" | "aria-disabled"
> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    /**
     * 押したあとの読み込み中。渡すと children を `PendingLabel` で包み、pending の間 label に `Spinner` を重ねて
     * 幅を保つ (ADR-0042)。変えるのは見た目だけで、状態の伝え方は呼び出し側が決める (ADR-0026)。渡さない呼び出しの DOM は変わらない
     */
    isPending?: boolean;
  };

/**
 * `buttonVariants` の見た目を纏う Void の `Link`。遷移と prefetch は `Link` が持つ。
 *
 * Base UI の `render` に `Link` を渡す形にしない。`Link` は prefetch の `visible` で IntersectionObserver を張る対象を
 * 内部の ref (`elementRef`) で持つ。`render` が ref を合成せず上書きすると観測する要素が無くなる、と推論している。
 * 推論であり、ブラウザで IntersectionObserver が張られるかは確かめていない。
 *
 * `ref` は型が許さない。実行時に渡すと `{...rest}` が `Link` 内部の ref を上書きし、`prefetch="visible"` の観測が働かなくなる。
 *
 * 無効なリンクは持たない。`disabled` と `aria-disabled` は型で外してある。`Link` は無効の状態で遷移を止めず、
 * `buttonVariants` の薄くする指定 (`data-disabled:`・`disabled:`) も a には当たらない。無効にしたい操作はリンクではなくボタンで表す。
 */
export function ButtonLink({
  className,
  variant,
  size,
  isPending,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      // registry の Button と同じ意匠 (buttonVariants) を纏うので slot 名も揃える。
      // registry の子孫セレクタ (button-group.tsx の `[data-slot=button]` 等) はこの属性で対象を選ぶ
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {isPending === undefined ? (
        children
      ) : (
        <PendingLabel isPending={isPending}>{children}</PendingLabel>
      )}
    </Link>
  );
}
