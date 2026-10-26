import type { Metadata } from "next";
import { redirect } from "next/navigation";
import UploadSources from "../components/UploadSources";
import RollsBrowser, { type RollCard } from "../components/RollsBrowser";
import { signInHref } from "@/lib/auth/providers";
import { getViewer } from "@/lib/auth/session";
import { getMyRollPreviews, getMyRollViews } from "@/lib/db";
import { getFanPhotos } from "@/lib/editorial";

export const metadata: Metadata = { title: "Папки · [37exp]" };

export default async function RollsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(signInHref("/rolls"));

  const [views, previews] = await Promise.all([getMyRollViews(viewer.id), getMyRollPreviews(viewer.id, 6)]);
  const rolls: RollCard[] = views.map((r) => ({
    ...r,
    strip: (previews[r.id] ?? []).map((f) => ({ id: f.id, w: f.w, h: f.h, color: f.color, v: f.v })),
  }));

  // плёнок нет (первый вход или все удалили): вместо пустого списка с фильтрами два способа загрузить плёнку.
  // Пустые папки показываются списком, как обычно. Фото Unsplash — из того же суточного кэша, что и заставка
  const empty = rolls.length === 0;
  const fan = empty ? await getFanPhotos() : [];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      {empty ? <UploadSources photos={fan} /> : <RollsBrowser rolls={rolls} />}
    </div>
  );
}
