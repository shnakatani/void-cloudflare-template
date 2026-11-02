/**
 * 遷移の読み込みが続いたときに、読み込み中の表示を出すまでの待ち。これより早く読み終えた遷移には出さない。
 * 値は TanStack Router の `defaultPendingMs` の既定 (1000ms、TanStack Router docs「Data Loading」の Showing a pending component) に倣う。
 * literal 型に固めない。テストが `vi.mock` でこの値を縮める
 */
export const PENDING_DISPLAY_DELAY_MS: number = 1000;
