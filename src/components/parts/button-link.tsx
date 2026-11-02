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
    /**
     * 開かせない間 (操作中の行など) true。同じ `a` のまま `aria-disabled` と `data-disabled` を付け、押下を止める。
     * 要素を替えないので、focus を持ったまま無効が解けても focus は動かない
     */
    disabled?: boolean;
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
 * 無効は `disabled` で表し、`aria-disabled` は直に渡させない。`Link` は無効の状態を持たず、`href` も外せないので、
 * 無効の間は渡された `onClick` に代えて `preventDefault()` だけをする `onClick` を渡す。`Link` は自分の遷移の前に `onClick` を呼び、
 * `defaultPrevented` なら遷移しない (Void 1.4.0 の `packages/react/src/runtime/link.tsx`)。ブラウザの既定の遷移
 * (修飾キーつきの押下) も同じく止まる。薄く描いて pointer を受けないのは、`buttonVariants` の `data-disabled:` の指定である
 */
export function ButtonLink({
  className,
  variant,
  size,
  isPending,
  disabled = false,
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
      {...(disabled && { "aria-disabled": true, "data-disabled": "", onClick: preventNavigation })}
    >
      {isPending === undefined ? (
        children
      ) : (
        <PendingLabel isPending={isPending}>{children}</PendingLabel>
      )}
    </Link>
  );
}

function preventNavigation(event: { preventDefault: () => void }) {
  event.preventDefault();
}
