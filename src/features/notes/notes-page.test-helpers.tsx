import { render } from "vitest-browser-react";
import type { NavigationState } from "void/pages-client";

import { Toaster } from "@/components/ui/toast";
import { createFakeRouter, type FakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import { NotesPage } from "./notes-page";
import type { NotesPageData } from "./notes-page-data";
import { notesListUrl } from "./notes-url";

const EMPTY_PAGE: NotesPageData = { q: "", notes: [], dialog: { kind: "closed" } };

/**
 * 一覧のページを props で描く。新しい props は戻り値の `rerender` で渡す (loader の応答の commit に当たる)。
 * `navigation` は `useNavigation()` が返す遷移の状態。`rerender` に渡すと、その描画から替わる (遷移の開始に当たる)
 */
export async function renderNotesPage(
  data: Partial<NotesPageData> = {},
  router?: FakeRouter,
  navigation?: NavigationState,
) {
  const props = { ...EMPTY_PAGE, ...data };
  const fakeRouter = router ?? createFakeRouter(notesListUrl(props.q));
  let currentNavigation = navigation;
  function ui(next: NotesPageData) {
    return (
      <VoidRouterProvider router={fakeRouter} navigation={currentNavigation}>
        <NotesPage {...next} />
        <Toaster />
      </VoidRouterProvider>
    );
  }
  const screen = await render(ui(props));
  return {
    screen,
    router: fakeRouter,
    rerender: (
      next: Partial<NotesPageData>,
      nextNavigation: NavigationState | undefined = currentNavigation,
    ) => {
      currentNavigation = nextNavigation;
      return screen.rerender(ui({ ...props, ...next }));
    },
  };
}
