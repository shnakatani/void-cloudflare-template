/** 1 つの path に求める応答。`location` は origin を除いた行き先で、無ければ `location` を見ない */
export interface ExpectedResponse {
  readonly path: string;
  readonly status: number;
  readonly location?: string;
}

/** 実際の応答から判定に使う 2 つ。`location` はヘッダが無ければ `null` */
export interface ObservedResponse {
  readonly status: number;
  readonly location: string | null;
}

/**
 * 期待した status と行き先で応答したかを突き合わせ、違反を人が読める形で返す。
 * 行き先は `origin` を付けた絶対 URL と完全一致で比べるので、相対の path や query の混ざった行き先も違反になる。
 * status が違う応答は、行き先を比べない。
 *
 * 突き合わせが空のときは throw する。空を許すと「1 件も検査していない」状態が違反ゼロと見分けられなくなる。
 *
 * @param origin 応答した server の origin (`http://127.0.0.1:<port>`)
 * @param checks 期待と実際の組。1 件以上が要る
 */
export function findRedirectViolations(
  origin: string,
  checks: readonly { readonly expected: ExpectedResponse; readonly actual: ObservedResponse }[],
): string[] {
  if (checks.length === 0) {
    throw new Error("findRedirectViolations: 突き合わせる応答が空です");
  }

  const violations: string[] = [];
  for (const { expected, actual } of checks) {
    if (actual.status !== expected.status) {
      violations.push(
        `${expected.path}: status が ${actual.status.toString()} で、${expected.status.toString()} ではない`,
      );
      continue;
    }
    if (expected.location === undefined) continue;
    const location = `${origin}${expected.location}`;
    if (actual.location !== location) {
      violations.push(
        `${expected.path}: location が ${String(actual.location)} で、${location} ではない`,
      );
    }
  }
  return violations;
}
