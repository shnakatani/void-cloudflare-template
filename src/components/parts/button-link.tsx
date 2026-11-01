import { Link } from "@void/react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";

import { buttonVariants } from "@/components/ui/button";

import { PendingLabel } from "./pending-label";

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "className"> &
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
 * `Link` の props に `ref` が無いので、この部品も `ref` を受けない。
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
