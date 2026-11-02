import * as v from "valibot";

/**
 * Better Auth の `emailAndPassword` の `minPasswordLength`・`maxPasswordLength` の既定。`auth.ts` で変えたら合わせる。
 * 食い違うと、client の検証を通った値が server で `PASSWORD_TOO_SHORT`・`PASSWORD_TOO_LONG` になる
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** 項目の呼称。検証メッセージと各項目の `v.metadata({ label })` が同じ定数を使う (ADR-0013) */
const NAME_LABEL = "名前";
const EMAIL_LABEL = "メールアドレス";
const PASSWORD_LABEL = "パスワード";

function requiredMessage(label: string): string {
  return `${label}を入力してください`;
}

/** server が同じ理由で拒んだときにも出す文言 (`auth-error.ts`) */
export const CREDENTIAL_MESSAGES = {
  invalidEmail: `${EMAIL_LABEL}の形式が正しくありません`,
  passwordTooShort: `${PASSWORD_LABEL}は ${PASSWORD_MIN_LENGTH} 文字以上にしてください`,
  passwordTooLong: `${PASSWORD_LABEL}は ${PASSWORD_MAX_LENGTH} 文字以下にしてください`,
} as const;

/** ログインと登録で pipe が分かれるので、同じ action を両方に渡す。pipe の外で作る action は `TInput` を型引数で与える */
const passwordLabel = v.metadata<string, { label: typeof PASSWORD_LABEL }>({
  label: PASSWORD_LABEL,
});

const email = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(requiredMessage(EMAIL_LABEL)),
  v.email(CREDENTIAL_MESSAGES.invalidEmail),
  v.metadata({ label: EMAIL_LABEL }),
);

export const loginSchema = v.object({
  email,
  password: v.pipe(v.string(), v.nonEmpty(requiredMessage(PASSWORD_LABEL)), passwordLabel),
});

export const signUpSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty(requiredMessage(NAME_LABEL)),
    v.metadata({ label: NAME_LABEL }),
  ),
  email,
  // ADR-0036 の code point ではなく、UTF-16 の code unit で数える (`v.minLength`・`v.maxLength`)。
  // Better Auth が `password.length` で判定するので、単位を揃えないと境界の値で client と server の判定が割れる
  password: v.pipe(
    v.string(),
    v.minLength(PASSWORD_MIN_LENGTH, CREDENTIAL_MESSAGES.passwordTooShort),
    v.maxLength(PASSWORD_MAX_LENGTH, CREDENTIAL_MESSAGES.passwordTooLong),
    passwordLabel,
  ),
});

export type LoginInput = v.InferOutput<typeof loginSchema>;
export type SignUpInput = v.InferOutput<typeof signUpSchema>;

/**
 * 項目の呼称。値はスキーマの metadata から型付きで読む。`satisfies` で登録の全項目を要求するので、
 * 項目を足すと呼称の追加も強制される。フォームの label とテストのアクセシブルネームがここを見る
 */
export const CREDENTIAL_FIELD_LABELS = {
  name: v.getMetadata(signUpSchema.entries.name).label,
  email: v.getMetadata(signUpSchema.entries.email).label,
  password: v.getMetadata(signUpSchema.entries.password).label,
} satisfies Record<keyof SignUpInput, string>;
