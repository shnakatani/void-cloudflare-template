import { useRouter } from "@void/react";
import * as v from "valibot";
import { auth } from "void/client";

import { ActionForm, ActionFormSubmit } from "@/components/action/form";
import { ButtonLink } from "@/components/parts/button-link";
import { CenteredCard } from "@/components/parts/centered-card";
import { CardPageTitle } from "@/components/parts/page-title";
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { HOME_PATH, LOGIN_PATH } from "@/features/auth/access";
import {
  CREDENTIAL_FIELD_LABELS,
  SIGN_UP_PASSWORD_DESCRIPTION,
  signUpSchema,
} from "@/features/auth/credentials";
import { requestAuth } from "@/features/auth/request-auth";
import { useAppForm } from "@/hooks/use-app-form";
import { submitClearingServerFieldErrors } from "@/lib/server-field-errors";
import { startVisit } from "@/lib/start-visit";

export default function SignUpPage() {
  const router = useRouter();
  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: { onSubmit: signUpSchema },
    onSubmit: async ({ value, formApi }) => {
      const input = v.parse(signUpSchema, value);
      // Better Auth の autoSignIn は既定で有効なので、登録の成功でログインした状態になる
      if (await requestAuth(formApi, () => auth.signUp.email(input))) {
        startVisit(router, HOME_PATH);
      }
    },
  });

  return (
    <CenteredCard>
      <CardHeader>
        <CardPageTitle>
          <h1>アカウントを作る</h1>
        </CardPageTitle>
      </CardHeader>
      <CardContent>
        <ActionForm submitAction={() => submitClearingServerFieldErrors(form)} noValidate>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => (
                <field.FormTextField
                  label={CREDENTIAL_FIELD_LABELS.name}
                  autoComplete="name"
                  fieldValue={field.state.value}
                />
              )}
            </form.AppField>
            <form.AppField name="email">
              {(field) => (
                <field.FormTextField
                  label={CREDENTIAL_FIELD_LABELS.email}
                  type="email"
                  autoComplete="email"
                  fieldValue={field.state.value}
                />
              )}
            </form.AppField>
            <form.AppField name="password">
              {(field) => (
                <field.FormTextField
                  label={CREDENTIAL_FIELD_LABELS.password}
                  description={SIGN_UP_PASSWORD_DESCRIPTION}
                  type="password"
                  autoComplete="new-password"
                  fieldValue={field.state.value}
                />
              )}
            </form.AppField>
            <ActionFormSubmit>アカウントを作る</ActionFormSubmit>
          </FieldGroup>
        </ActionForm>
      </CardContent>
      <CardFooter>
        <ButtonLink variant="link" href={LOGIN_PATH}>
          ログイン
        </ButtonLink>
      </CardFooter>
    </CenteredCard>
  );
}
