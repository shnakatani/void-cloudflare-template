import { NavigationContext, RouterContext, SharedContext } from "@void/react";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { NavigationState, VisitOptions, VoidRouter } from "void/pages-client";

const ORIGIN = "http://localhost";

const idleNavigation: NavigationState = { state: "idle", location: null, method: null };

export type FakeRouter = VoidRouter & {
  readonly visits: ReadonlyArray<{ url: string; options: VisitOptions | undefined }>;
  readonly refreshCount: number;
  /** `/a?q=x` のように query も受ける。commit された遷移を作る */
  navigate(path: string): void;
  subscribe(listener: () => void): () => void;
};

/**
 * Void の router の偽物。`visit` は記録だけして遷移せず、`navigate` が遷移の commit を作る (ADR-0048)。
 */
export function createFakeRouter(initialPath = "/"): FakeRouter {
  let url = new URL(initialPath, ORIGIN);
  let refreshCount = 0;
  const visits: Array<{ url: string; options: VisitOptions | undefined }> = [];
  const listeners = new Set<() => void>();

  return {
    _hoverDelay: 0,
    get url() {
      return new URL(url.href);
    },
    get path() {
      return url.pathname;
    },
    get query() {
      return new URLSearchParams(url.searchParams);
    },
    params: {},
    visits,
    get refreshCount() {
      return refreshCount;
    },
    visit(target, options) {
      visits.push({ url: String(target), options });
      return Promise.resolve(undefined);
    },
    refresh() {
      refreshCount += 1;
      return Promise.resolve(undefined);
    },
    prefetch() {
      return Promise.resolve(undefined);
    },
    flush() {},
    flushAll() {},
    navigate(path) {
      url = new URL(path, ORIGIN);
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function VoidRouterProvider({
  router,
  navigation,
  shared,
  children,
}: {
  router: FakeRouter;
  navigation?: NavigationState;
  /** `useShared()` が返す値。渡さないと包まず、`useShared()` は Void のページの外と同じく throw する */
  shared?: Record<string, unknown>;
  children: ReactNode;
}) {
  const href = useSyncExternalStore(
    (listener) => router.subscribe(listener),
    () => router.url.href,
  );
  // context の値の同一性が変わらないと、子の useRouter() が再描画されない。
  // 現在の URL から作り直した値を渡して、navigate のたびに購読者を描き直す
  const value = useMemo<VoidRouter>(() => {
    const current = new URL(href);
    return {
      _hoverDelay: router._hoverDelay,
      url: current,
      path: current.pathname,
      query: current.searchParams,
      params: router.params,
      visit: (target, options) => router.visit(target, options),
      refresh: (options) => router.refresh(options),
      prefetch: (target, options) => router.prefetch(target, options),
      flush: (target, method) => {
        router.flush(target, method);
      },
      flushAll: () => {
        router.flushAll();
      },
    };
  }, [href, router]);
  return (
    <RouterContext.Provider value={value}>
      <NavigationContext.Provider value={navigation ?? idleNavigation}>
        {shared === undefined ? (
          children
        ) : (
          <SharedContext.Provider value={shared}>{children}</SharedContext.Provider>
        )}
      </NavigationContext.Provider>
    </RouterContext.Provider>
  );
}
