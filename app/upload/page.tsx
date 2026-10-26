import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInHref } from "@/lib/auth/providers";
import { requireUser } from "@/lib/auth/session";
import { getMyCameras, getMyFilms, getMyRollViews } from "@/lib/db";
import { getFanPhotos } from "@/lib/editorial";
import UploadFlow from "../components/UploadFlow";

export const metadata: Metadata = { title: "Загрузка · [37exp]" };

export default async function UploadPage() {
  // загружать может любой вошедший, в свой архив
  const user = await requireUser();
  // без входа сразу к сервису входа (своей страницы входа нет)
  if (!user) redirect(signInHref("/upload"));

  const [rolls, cameras, films, photos] = await Promise.all([
    getMyRollViews(user.id),
    getMyCameras(user.id),
    getMyFilms(user.id),
    // тот же суточный кэш, что у заставки: лишних запросов к Unsplash нет
    getFanPhotos(),
  ]);
  // камера и формат новой плёнки — как у последней созданной; плёнок нет, а камера одна — она
  const last = rolls.at(-1);
  const cameraId = last ? (cameras.some((c) => c.id === last.cameraId) ? last.cameraId : "") : cameras.length === 1 ? cameras[0].id : "";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 md:px-5">
      <UploadFlow
        films={films}
        cameras={cameras}
        // формат по умолчанию — 35 мм; 120 выбирается строкой подсказки плёнки или кнопкой в поле
        defaults={{ cameraId, format: "35" }}
        photos={photos}
        first={rolls.length === 0}
      />
    </div>
  );
}
