/** 戻る・進むでブラウザが遷移のアニメーションを出したあと、html に付ける属性。`src/styles.css` が View Transition を止める */
export const UA_VISUAL_TRANSITION_ATTRIBUTE = "data-ua-visual-transition";

/**
 * 戻る・進むでブラウザが自分で遷移のアニメーションを出したか (`popstate` の `hasUAVisualTransition`) を、`root` の属性に写す。
 * 属性がある間は `src/styles.css` が View Transition のアニメーションを止め、ブラウザの遷移と二重に動かさない (ADR-0058)。
 * Void は戻る・進むの遷移を自分の `popstate` の listener から始め、遷移ごとに View Transition を切る口を持たないので、CSS で止める。
 * 属性は次の操作 (`pointerdown`・`keydown`) か、アニメーションの無い戻る・進むで外す。返す関数で listener を外す
 */
export function mirrorUAVisualTransition(target: Window, root: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  target.addEventListener(
    "popstate",
    (event) => {
      root.toggleAttribute(UA_VISUAL_TRANSITION_ATTRIBUTE, event.hasUAVisualTransition);
    },
    { signal },
  );
  const clear = () => {
    root.removeAttribute(UA_VISUAL_TRANSITION_ATTRIBUTE);
  };
  // 次の遷移を始める操作より先に外す。capture で受け、ページの handler が止めても外す
  target.addEventListener("pointerdown", clear, { signal, capture: true });
  target.addEventListener("keydown", clear, { signal, capture: true });
  return () => {
    controller.abort();
    clear();
  };
}
