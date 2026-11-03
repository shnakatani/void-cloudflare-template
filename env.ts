import { defineEnv } from "void/env";

// アプリが読む環境変数の宣言。足し方と値の渡し方は docs/guides/dependencies-and-toolchain.md「環境変数を足す」。
// BETTER_AUTH_SECRET は宣言しない。Void の auth が読み、deploy が無ければ作る (ADR-0004)
export default defineEnv({});
