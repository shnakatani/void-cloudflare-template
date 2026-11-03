import { SearchIcon } from "lucide-react";
import { type SubmitEvent, useId } from "react";

import { FieldError } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

import { NOTE_SEARCH_LABEL } from "./note-search";

/**
 * 一覧の検索欄。値は親が持つ (制御コンポーネント。入力値は緊急更新のまま、ADR-0015)。
 * URL への確定は submit (Enter / 検索ボタン) で親が行う。`type="search"` で role は searchbox、
 * landmark は `<search>` 要素。`error` は入力欄の下に出し、入力欄の説明にも結ぶ。
 */
export function NoteSearchField({
  value,
  error,
  onValueChange,
  onSubmit,
}: {
  value: string;
  /** 入力が送れない理由。null なら出さない */
  error: string | null;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const errorId = useId();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <search data-slot="note-search">
      <form className="flex flex-col gap-1" onSubmit={handleSubmit}>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={NOTE_SEARCH_LABEL}
            placeholder={NOTE_SEARCH_LABEL}
            // 上限は maxLength で打ち止めにしない。超えたら error で伝える (ADR-0036)
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit">検索</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {error === null ? null : (
          // 文言の幅で検索欄を広げない。広げると、打っている最中に入力欄が横へ動く
          <div className="w-0 min-w-full">
            <FieldError id={errorId}>{error}</FieldError>
          </div>
        )}
      </form>
    </search>
  );
}
