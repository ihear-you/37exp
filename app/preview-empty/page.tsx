import EmptyArchive from "../components/EmptyArchive";
import { getEditorialPhotos } from "@/lib/unsplash";

/** Служебная страница: посмотреть папки без единой плёнки (первый вход), не опустошая настоящий архив. Дев-инструмент. */
export default async function PreviewEmptyPage() {
  const fan = (await getEditorialPhotos()).slice(0, 4).map((p) => ({ id: p.id, src: p.src, color: p.color }));
  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      <EmptyArchive photos={fan} />
    </div>
  );
}
