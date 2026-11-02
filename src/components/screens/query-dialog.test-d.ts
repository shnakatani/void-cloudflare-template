import { createElement } from "react";

import { StatusDialogContent } from "./query-dialog";

// 読み込み中は QueryDialog が出す。renderDialog から pending を描くと、loader の props があっても読み込み中のまま残る
// @ts-expect-error -- pending は StatusDialogContent の status に無い
createElement(StatusDialogContent, { status: "pending", title: "項目", openerId: null });
