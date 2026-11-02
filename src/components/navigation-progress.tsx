import { useNavigation } from "@void/react";

/** 遷移の読み込み中に、画面の上端へ細い帯を出す。root の layout に置く。何を伝え何を伝えないか、遅れの値は ADR-0057 の Consequences が持つ */
export function NavigationProgress() {
  if (useNavigation().state !== "loading") {
    return null;
  }
  return (
    <div
      data-slot="navigation-progress"
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-0.5 bg-primary animate-in fill-mode-backwards delay-300 fade-in"
    />
  );
}
