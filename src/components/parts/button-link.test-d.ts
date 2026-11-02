import { createElement } from "react";

import { ButtonLink } from "./button-link";

// Void の Link は無効の状態で遷移を止めないので、無効なリンクは型で止める
// @ts-expect-error -- disabled は ButtonLink の props に無い
createElement(ButtonLink, { href: "/", disabled: true });
// @ts-expect-error -- aria-disabled は ButtonLink の props に無い
createElement(ButtonLink, { href: "/", "aria-disabled": true });
