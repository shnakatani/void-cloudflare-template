import { useShared } from "@void/react";
import { StrictMode, useEffect, type ReactNode } from "react";

import { AppDevtools } from "@/components/app-devtools";
import { LiveRegions } from "@/components/live-regions";
import { NavigationProgress } from "@/components/navigation-progress";
import { RouteAnnouncer } from "@/components/route-announcer";
import { AppErrorBoundary } from "@/components/screens/app-error";
import { Toaster } from "@/components/ui/toast";
import { LogoutButton } from "@/features/auth/logout-button";
import type { AppShared } from "@/features/auth/shared";
import { mirrorUAVisualTransition } from "@/lib/ua-visual-transition";

// root layout が読む CSS は、Void がこの layout の下のすべてのページの <head> に載せる
import "@/styles.css";

/**
 * すべてのページを包む。Void は client の入り口を StrictMode で包まないので、アプリの StrictMode はここで包む (ADR-0039)。
 */
export default function Layout({ children }: { children: ReactNode }) {
  // 型を引数で渡す。`CloudContextVariables` の augmentation (`middleware/01.auth.ts`) は worker の program にだけある
  const { user } = useShared<AppShared>().auth;
  // 戻る・進むでブラウザが遷移のアニメーションを出したら、View Transition を重ねない (ADR-0058)
  useEffect(() => mirrorUAVisualTransition(window, document.documentElement), []);
  return (
    <StrictMode>
      {user && (
        <header className="flex items-center justify-end gap-4 border-b p-4">
          <p className="text-sm">{user.email}</p>
          <LogoutButton />
        </header>
      )}
      {/* ページ本体を landmark へ入れる。無いと支援技術に本文へ飛ぶ手段が無く、
          axe-core の region ルールが「All page content should be contained by landmarks」で報告する */}
      <main>
        {/* Toaster と LiveRegions は境界の外に置き、全画面のエラー表示の間も通知を出せるようにする (ADR-0050) */}
        <AppErrorBoundary>{children}</AppErrorBoundary>
        <Toaster />
      </main>
      <NavigationProgress />
      <LiveRegions />
      <RouteAnnouncer />
      <AppDevtools />
    </StrictMode>
  );
}
