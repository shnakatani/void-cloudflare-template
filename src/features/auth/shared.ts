/**
 * middleware が全ページへ渡す user。Better Auth の `AuthUser` をそのまま渡さず、画面が使う項目だけを詰め、使わない項目を page data に載せない。
 * 足し方は docs/guides/auth.md「全ページで user を読む」
 */
export type SharedUser = { readonly id: string; readonly email: string; readonly name: string };

/** `useShared<AppShared>()` で読む (ADR-0053) */
export type AppShared = { readonly auth: { readonly user: SharedUser | null } };
