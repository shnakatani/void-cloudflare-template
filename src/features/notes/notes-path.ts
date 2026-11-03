import type { RoutePath } from "void/routes";

/** 一覧のページの path。ほかのページのリンクと守る path の一覧も読むので、型のほかは import しない (ADR-0059) */
export const NOTES_PATH = "/notes" satisfies RoutePath;
