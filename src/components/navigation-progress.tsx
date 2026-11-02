import { useNavigation } from "@void/react";

/**
 * 遷移の読み込み中に、画面の上端へ細い帯を出す。Void の client の遷移は前のページを commit まで描いたまま残し、
 * route ごとの読み込み中を出す口を持たない (ADR-0057 の Consequences)。root の layout に置く。
 *
 * 帯は遅れて現れ、短い読み込みでは見せない。読み上げは遷移の読み上げの部品 (ADR-0049) と各ページの通知が持つので、
 * 帯は支援技術から隠す。送信 (`"submitting"`) には出さない。送信中の印は押した部品の pending が持つ (ADR-0017)
 */
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
