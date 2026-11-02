/** View Transition を始め、animation の付いた擬似要素を返す */
export async function animatedPseudoElements(): Promise<string[]> {
  const transition = document.startViewTransition(() => {});
  await transition.ready;
  const pseudoElements = document
    .getAnimations()
    .map((animation) =>
      animation.effect instanceof KeyframeEffect ? animation.effect.pseudoElement : null,
    )
    .filter((pseudoElement) => pseudoElement !== null);
  await transition.finished;
  return pseudoElements;
}
