import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { mirrorUAVisualTransition, UA_VISUAL_TRANSITION_ATTRIBUTE } from "./ua-visual-transition";

/**
 * 戻る・進むは合成の `popstate` で起こす。ブラウザが遷移のアニメーションを出す戻る・進む (スワイプ) は、
 * テストのブラウザでは起こせない
 */
function mirror() {
  const root = document.createElement("div");
  const dispose = mirrorUAVisualTransition(window, root);
  onTestFinished(dispose);
  return {
    root,
    marked: () => root.hasAttribute(UA_VISUAL_TRANSITION_ATTRIBUTE),
    popstate: (hasUAVisualTransition: boolean) =>
      window.dispatchEvent(new PopStateEvent("popstate", { hasUAVisualTransition })),
    dispose,
  };
}

/** View Transition を始め、擬似要素に付いた animation の名前を数える */
async function pseudoElementAnimationCount(): Promise<number> {
  const transition = document.startViewTransition(() => {});
  await transition.ready;
  const count = document
    .getAnimations()
    .filter(
      (animation) =>
        animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement !== null,
    ).length;
  await transition.finished;
  return count;
}

describe("mirrorUAVisualTransition", () => {
  it("戻る・進むがまだ無ければ属性を付けない", () => {
    const { marked } = mirror();
    expect(marked()).toBe(false);
  });

  it("ブラウザが遷移のアニメーションを出した戻る・進むで属性を付ける", () => {
    const { marked, popstate } = mirror();
    popstate(true);
    expect(marked()).toBe(true);
  });

  it.each([
    { input: "pointerdown", act: () => userEvent.click(document.body) },
    { input: "keydown", act: () => userEvent.keyboard("a") },
  ])("付けたあとの次の操作 ($input) で外し、また View Transition を使う", async ({ act }) => {
    const { marked, popstate } = mirror();
    popstate(true);
    await act();
    expect(marked()).toBe(false);
  });

  it("ブラウザがアニメーションを出した戻る・進むの後に、出さなかった戻る・進むが続けば外す", () => {
    const { marked, popstate } = mirror();
    popstate(true);
    popstate(false);
    expect(marked()).toBe(false);
  });

  it("後始末のあとは戻る・進むを写さない", () => {
    const { marked, popstate, dispose } = mirror();
    dispose();
    popstate(true);
    expect(marked()).toBe(false);
  });
});

describe("属性と styles.css", () => {
  it("属性がある間、View Transition の擬似要素はアニメーションしない", async () => {
    const root = document.documentElement;
    expect(await pseudoElementAnimationCount()).toBeGreaterThan(0);

    root.setAttribute(UA_VISUAL_TRANSITION_ATTRIBUTE, "");
    onTestFinished(() => {
      root.removeAttribute(UA_VISUAL_TRANSITION_ATTRIBUTE);
    });
    expect(await pseudoElementAnimationCount()).toBe(0);
  });
});
