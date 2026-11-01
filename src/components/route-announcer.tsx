import { useNavigation, useRouter } from "@void/react";
import { useEffect, useRef } from "react";

import { focusPageHeading } from "@/lib/focus-page-heading";
import { announce } from "@/lib/live-announcer";

type FocusChangeRecord = {
  /** 記録を始めてから、利用者かアプリが focus を動かしたか */
  changed: boolean;
  stop: () => void;
};

/**
 * 遷移中に利用者かアプリが focus を動かしたかを記録する (ADR-0049)。直前に focusin を受けた要素 (始めは記録を
 * 始めたときに focus していた要素) と違う要素が focusin を受けたら動いたとみなし、前と同じ要素へ戻っても動いたとみなす。
 * focusin に出ない動き (blur() で viewport へ外すなど) は見えない。
 * capture で受けるのは、下の要素の listener が stopPropagation しても記録を漏らさないため
 */
function recordFocusChanges(): FocusChangeRecord {
  let focused: EventTarget | null = document.activeElement;
  function onFocusIn(event: FocusEvent) {
    if (event.target !== focused) {
      record.changed = true;
    }
    focused = event.target;
  }
  const record: FocusChangeRecord = {
    changed: false,
    stop: () => {
      document.removeEventListener("focusin", onFocusIn, { capture: true });
    },
  };
  document.addEventListener("focusin", onFocusIn, { capture: true });
  return record;
}

/**
 * path の変わる遷移を利用者に伝える。新しいページの見出し (`focusPageHeading` が選ぶ) へ focus を移し、
 * `document.title` を読み上げる (ADR-0049)。root の layout に置き、DOM を描かない。
 *
 * Void は遷移の開始と完了を購読させないので、`useNavigation()` が idle 以外の新しい値になった描画から focus の記録を始め、
 * `useRouter().path` が変わった描画 (新しいページの描画) の effect で見出しへ focus を移し、`useNavigation()` が
 * idle に戻った描画 (遷移の完了) の effect で title を読み上げる。Void は新しいページを描いた後、遷移を完了する前に
 * `document.title` を書き換えるので、完了の時点の title は新しいページの値になっている。
 * 新しいページの描画の effect で読むと、ページの layout effect が同期の更新を起こしたときに前の title を読む。
 * query だけの変化と最初の描画では伝えない。
 */
export function RouteAnnouncer(): null {
  const { path } = useRouter();
  const navigation = useNavigation();
  const focusChanges = useRef<FocusChangeRecord | null>(null);
  const handledPath = useRef(path);
  const titlePending = useRef(false);

  // 依存は state ではなく値そのものに置く。Void は遷移を始めるたびに新しい値を作り、ページの描画では同じ値を保つ
  // (pages-client.ts の appReducer)。state で見ると、遷移が重なったときに前の遷移の記録が残る
  useEffect(() => {
    if (navigation.state === "idle") {
      return;
    }
    const record = recordFocusChanges();
    focusChanges.current = record;
    // 記録は消さない。遷移の終わりと path の変化が同じ描画に来ると、この後始末が下の effect より先に走る
    return record.stop;
  }, [navigation]);

  useEffect(() => {
    // 扱った path を ref に持ち、同じなら focus を動かさない。最初の描画と StrictMode の付け直しはここで止まる
    if (path !== handledPath.current) {
      handledPath.current = path;
      const record = focusChanges.current;
      focusChanges.current = null;
      record?.stop();
      focusPageHeading(record?.changed ?? false);
      titlePending.current = true;
    }
    // Void の遷移では、新しいページの描画と遷移の完了は別の描画に来る。path の変化と idle が同じ描画に来たら
    // (commit が失敗して前のページへ戻るとき) ここで続けて読み上げる
    if (titlePending.current && navigation.state === "idle") {
      titlePending.current = false;
      announce(document.title);
    }
  }, [path, navigation]);

  return null;
}
