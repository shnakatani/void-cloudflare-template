import { useRouter } from "@void/react";
import { auth } from "void/client";

import { ActionButton } from "@/components/action/button";
import { toastMutationError } from "@/lib/mutation-error";

import { LOGIN_PATH } from "./access";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    // reject (fetch の失敗) も toast に出す。Action の reject は error boundary へ届き、画面ごと差し替わる (ADR-0016)
    const result = await auth.signOut().catch((error: unknown) => {
      toastMutationError(error);
      return null;
    });
    if (result === null) return;
    if (result.error) {
      toastMutationError(result.error);
      return;
    }
    await router.visit(LOGIN_PATH);
  }
  return (
    <ActionButton variant="outline" action={logout}>
      ログアウト
    </ActionButton>
  );
}
