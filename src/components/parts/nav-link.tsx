import { Link, useRouter } from "@void/react";
import type { ComponentProps } from "react";

const BASE_URL = "http://localhost";

/**
 * 現在のページを指すとき `aria-current="page"` を付ける `Link`。
 * 同じ origin のリンク専用。origin は比べないので、外部 URL でも pathname が同じなら `aria-current` が付く。
 * `href` の query と hash は比べず、pathname だけを `useRouter().path` と比べる。
 * Void の `path` は URL の pathname そのままで末尾の `/` を正規化しないので、`/notes` と `/notes/` は別のページとして扱う。
 */
export function NavLink({ href, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const isCurrent = new URL(href, BASE_URL).pathname === router.path;
  return <Link href={href} aria-current={isCurrent ? "page" : undefined} {...props} />;
}
