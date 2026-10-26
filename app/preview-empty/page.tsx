import UploadSources from "../components/UploadSources";
import { getFanPhotos } from "@/lib/editorial";

/** Служебная страница: посмотреть папки без единой плёнки (первый вход), не опустошая настоящий архив. Дев-инструмент. */
export default async function PreviewEmptyPage() {
  const fan = await getFanPhotos();
  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      <UploadSources photos={fan} />
    </div>
  );
}
