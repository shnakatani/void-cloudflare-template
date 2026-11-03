import { NavigationContext, RouterContext, SharedContext } from "@void/react";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { NavigationState, VisitOptions, VoidRouter } from "void/pages-client";
import type { RouteUrlInput } from "void/routes";

const ORIGIN = "http://localhost";

const idleNavigation: NavigationState = { state: "idle", location: null, method: null };

export type FakeRouter = VoidRouter & {
  readonly visits: ReadonlyArray<{ url: string; options: VisitOptions | undefined }>;
  /** `refresh` を呼んだ順の options */
  readonly refreshes: ReadonlyArray<VisitOptions | undefined>;
  /** `/a?q=x` のように query も受ける。commit された遷移を作る */
  navigate(path: string): void;
  subscribe(listener: () => void): () => void;
};

/** アプリは `routeUrl` で組んだ文字列を渡す (ADR-0059)。行き先の object を受けたら記録の形を決めていないので止める */
function visitedUrl(target: RouteUrlInput): string {
  if (typeof target === "string") return target;
  if (target instanceof URL) return target.href;
  throw new Error(`偽の router は行き先の object を記録しない: ${JSON.stringify(target)}`);
}

/**
 * Void の router の偽物。`visit` は記録だけして遷移せず、`navigate` が遷移の commit を作る (ADR-0048)。
 */
export function createFakeRouter(initialPath = "/"): FakeRouter {
  let url = new URL(initialPath, ORIGIN);
  const visits: Array<{ url: string; options: VisitOptions | undefined }> = [];
  const refreshes: Array<VisitOptions | undefined> = [];
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
    refreshes,
    visit(target, options) {
      visits.push({ url: visitedUrl(target), options });
      return Promise.resolve(undefined);
    },
    refresh(options) {
      refreshes.push(options);
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
