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
 * `navigation` は `useNavigation()` が返す遷移の状態
 */
export async function renderNotesPage(
  data: Partial<NotesPageData> = {},
  router?: FakeRouter,
  navigation?: NavigationState,
) {
  const props = { ...EMPTY_PAGE, ...data };
  const fakeRouter = router ?? createFakeRouter(notesListUrl(props.q));
  function ui(next: NotesPageData) {
    return (
      <VoidRouterProvider router={fakeRouter} navigation={navigation}>
        <NotesPage {...next} />
        <Toaster />
      </VoidRouterProvider>
    );
  }
  const screen = await render(ui(props));
  return {
    screen,
    router: fakeRouter,
    rerender: (next: Partial<NotesPageData>) => screen.rerender(ui({ ...props, ...next })),
  };
}
