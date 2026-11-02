import { NotesPage } from "@/features/notes/notes-page";

import type { Props } from "./notes.server";

export default function Page(props: Props) {
  return <NotesPage {...props} />;
}
