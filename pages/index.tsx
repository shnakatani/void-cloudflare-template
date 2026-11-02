import { ButtonLink } from "@/components/parts/button-link";
import { APP_NAME } from "@/lib/app-name";

export default function Page() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1>{APP_NAME}</h1>
      {/* flex-col の既定 (align-items: stretch) を打ち消し、ボタン幅を内容に合わせる */}
      <ButtonLink href="/notes" className="self-start">
        メモ一覧へ
      </ButtonLink>
    </div>
  );
}
