import { useRouter } from "@void/react";
import * as v from "valibot";
import { auth } from "void/client";

import { ActionForm, ActionFormSubmit } from "@/components/action/form";
import { ButtonLink } from "@/components/parts/button-link";
import { CenteredCard } from "@/components/parts/centered-card";
import { CardPageTitle } from "@/components/parts/page-title";
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { HOME_PATH, SIGNUP_PATH } from "@/features/auth/access";
import { CREDENTIAL_FIELD_LABELS, loginSchema } from "@/features/auth/credentials";
import { requestAuth } from "@/features/auth/request-auth";
import { useAppForm } from "@/hooks/use-app-form";
import { submitClearingServerFieldErrors } from "@/lib/server-field-errors";

export default function LoginPage() {
  const router = useRouter();
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value, formApi }) => {
      const input = v.parse(loginSchema, value);
      if (await requestAuth(formApi, () => auth.signIn.email(input))) {
        await router.visit(HOME_PATH);
      }
    },
  });

  return (
    <CenteredCard>
      <CardHeader>
        <CardPageTitle>
          <h1>ログイン</h1>
        </CardPageTitle>
      </CardHeader>
      <CardContent>
        <ActionForm submitAction={() => submitClearingServerFieldErrors(form)} noValidate>
          <FieldGroup>
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
                  type="password"
                  autoComplete="current-password"
                  fieldValue={field.state.value}
                />
              )}
            </form.AppField>
            <ActionFormSubmit>ログイン</ActionFormSubmit>
          </FieldGroup>
        </ActionForm>
      </CardContent>
      <CardFooter>
        <ButtonLink variant="link" href={SIGNUP_PATH}>
          アカウントを作る
        </ButtonLink>
      </CardFooter>
    </CenteredCard>
  );
}
