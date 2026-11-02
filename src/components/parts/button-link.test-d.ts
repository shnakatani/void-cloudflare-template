import { createElement } from "react";

import { ButtonLink } from "./button-link";

// 無効は disabled で渡す。aria-disabled だけを渡すと、読み上げは無効でも押せば遷移する
// @ts-expect-error -- aria-disabled は ButtonLink の props に無い
createElement(ButtonLink, { href: "/", "aria-disabled": true });
