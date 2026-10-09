import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProvider } from "@/lib/auth/providers";
import { requireUser } from "@/lib/auth/session";
import { getMyCameras, getMyFilms, getMyRollViews } from "@/lib/db";
import BackButton from "../components/BackButton";
import UploadPrototype from "../components/UploadPrototype";

export const metadata: Metadata = { title: "Загрузка · [37exp]" };

export default async function UploadPage() {
  // загружать может любой вошедший, в свой архив
  const user = await requireUser();
  // без входа сразу к Яндексу, без промежуточной страницы /login; если ключей Яндекса нет — на /login, там покажется причина
  if (!user) redirect(getProvider("yandex").configured() ? "/api/auth/yandex?next=/upload" : "/login?next=/upload");

  const [rolls, cameras, films] = await Promise.all([getMyRollViews(user.id), getMyCameras(user.id), getMyFilms(user.id)]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-20 pt-6 md:px-5 md:pt-8">
      <div className="mb-4">
        <BackButton />
      </div>
      <UploadPrototype rolls={rolls.map((r) => ({ id: r.id, title: r.title, year: r.year, month: r.month }))} cameras={cameras} films={films} />
    </div>
  );
}
