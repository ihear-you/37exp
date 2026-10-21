import type { Metadata } from "next";
import { redirect } from "next/navigation";
import EmptyArchive from "../components/EmptyArchive";
import RollsBrowser, { type RollCard } from "../components/RollsBrowser";
import { getViewer } from "@/lib/auth/session";
import { getMyRollPreviews, getMyRollViews } from "@/lib/db";
import { getEditorialPhotos } from "@/lib/unsplash";

export const metadata: Metadata = { title: "Папки · [37exp]" };

export default async function RollsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/rolls");

  const [views, previews] = await Promise.all([getMyRollViews(viewer.id), getMyRollPreviews(viewer.id, 6)]);
  const rolls: RollCard[] = views.map((r) => ({
    ...r,
    strip: (previews[r.id] ?? []).map((f) => ({ id: f.id, w: f.w, h: f.h, color: f.color, v: f.v })),
  }));

  // плёнок ещё нет: вместо пустого списка с фильтрами два способа загрузить первую.
  // Фото Unsplash берутся из того же суточного кэша, что и заставка: лишних запросов к Unsplash нет
  const fan = rolls.length ? [] : (await getEditorialPhotos()).slice(0, 4).map((p) => ({ id: p.id, src: p.src, color: p.color }));

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      {rolls.length ? <RollsBrowser rolls={rolls} /> : <EmptyArchive photos={fan} />}
    </div>
  );
}
