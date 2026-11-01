/**
 * middleware が全ページへ渡す user。Better Auth の `AuthUser` をそのまま渡さず、画面が使う項目だけを詰める。
 * `AuthUser` の `Date` は page data の JSON を通ると browser で文字列になり、型と食い違う (voidzero-dev/void#606)
 */
export type SharedUser = { readonly id: string; readonly email: string; readonly name: string };

/** `useShared<AppShared>()` で読む (ADR-0053) */
export type AppShared = { readonly auth: { readonly user: SharedUser | null } };
