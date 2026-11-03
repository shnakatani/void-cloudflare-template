import { useNavigation } from "@void/react";
import { useEffect, useEffectEvent, useRef } from "react";
import type { NavigationState } from "void/pages-client";

import { chunkLoadErrorDocumentLoad, loadDocument } from "@/lib/chunk-load-error";

/**
 * 遷移の先のページの chunk が読めなかったら、待っていた遷移の行き先の文書を開く (ADR-0049「chunk の読み込みの失敗」)。
 * root の layout の `AppErrorBoundary` の外に置き、DOM を描かない。
 *
 * Void 1.5.0 は chunk の失敗を受けると前のページへ戻すだけなので、Vite の build が dynamic import の失敗で出す
 * `vite:preloadError` を受ける。GET の遷移では Void は遷移の開始と同時にページの chunk を読み始め、event はデータの
 * 応答を待たずに届く。送信では応答を受けてから chunk を読む。どちらも event の時点の `useNavigation()` は遷移の開始を
 * 描き終えていて、待っていた遷移を持つ。redirect で別のページが選ばれる GET の遷移でも開き、server の redirect を経て
 * 選ばれたページと URL に着く。`preventDefault()` は呼ばず、元の失敗は Void へそのまま流す
 */
export function ChunkLoadErrorRecovery(): null {
  const navigation = useNavigation();
  // 文書を開いた遷移。Void は遷移を始めるたびに `useNavigation()` の値を作り直し、遷移の間は同じ値を保つ
  const openedFor = useRef<NavigationState | null>(null);
  const onPreloadError = useEffectEvent(() => {
    if (openedFor.current === navigation) {
      return;
    }
    const load = chunkLoadErrorDocumentLoad(navigation, new URL(window.location.href));
    if (load) {
      openedFor.current = navigation;
      loadDocument(load);
    }
  });

  useEffect(() => {
    function handlePreloadError() {
      onPreloadError();
    }
    window.addEventListener("vite:preloadError", handlePreloadError);
    return () => {
      window.removeEventListener("vite:preloadError", handlePreloadError);
    };
  }, []);

  return null;
}
