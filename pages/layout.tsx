import { StrictMode, type ReactNode } from "react";

import { AppDevtools } from "@/components/app-devtools";
import { LiveRegions } from "@/components/live-regions";
import { RouteAnnouncer } from "@/components/route-announcer";
import { AppErrorBoundary } from "@/components/screens/app-error";
import { Toaster } from "@/components/ui/toast";

// root layout が読む CSS は、Void がこの layout の下のすべてのページの <head> に載せる
import "@/styles.css";

/**
 * すべてのページを包む。Void は client の入り口を StrictMode で包まないので、アプリの StrictMode はここで包む (ADR-0039)。
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      {/* ページ本体を landmark へ入れる。無いと支援技術に本文へ飛ぶ手段が無く、
          axe-core の region ルールが「All page content should be contained by landmarks」で報告する */}
      <main>
        {/* Toaster と LiveRegions は境界の外に置き、全画面のエラー表示の間も通知を出せるようにする (ADR-0050) */}
        <AppErrorBoundary>{children}</AppErrorBoundary>
        <Toaster />
      </main>
      <LiveRegions />
      <RouteAnnouncer />
      <AppDevtools />
    </StrictMode>
  );
}
