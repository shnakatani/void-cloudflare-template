import type { ReactTable, RowData } from "@tanstack/react-table";
import { useTanStackTableDevtools } from "@tanstack/react-table-devtools";

import type { DataTableFeatures } from "./data-table-features";

/** `DataTable` の table を Table Devtools に登録する。`data-table.tsx` が dev だけで読む */
export function TableDevtoolsRegistration<TData extends RowData>({
  table,
}: {
  table: ReactTable<DataTableFeatures, TData>;
}) {
  useTanStackTableDevtools(table);
  return null;
}
