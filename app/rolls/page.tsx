import type { Metadata } from "next";
import { redirect } from "next/navigation";
import RollsBrowser, { type RollCard } from "../components/RollsBrowser";
import { getViewer } from "@/lib/auth/session";
import { getMyRollPreviews, getMyRollViews } from "@/lib/db";

export const metadata: Metadata = { title: "Папки · [37exp]" };

export default async function RollsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/rolls");

  const [views, previews] = await Promise.all([getMyRollViews(viewer.id), getMyRollPreviews(viewer.id, 6)]);
  const rolls: RollCard[] = views.map((r) => ({
    ...r,
    strip: (previews[r.id] ?? []).map((f) => ({ id: f.id, w: f.w, h: f.h, color: f.color })),
  }));

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      <RollsBrowser rolls={rolls} />
    </div>
  );
}
