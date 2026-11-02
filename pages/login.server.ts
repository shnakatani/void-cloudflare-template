import { defineHead } from "void";

import { pageTitle } from "@/lib/page-title";

export const head = defineHead(() => ({ title: pageTitle("ログイン") }));
