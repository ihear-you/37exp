import type { Metadata } from "next";
import RollsBrowser, { type RollCard } from "../components/RollsBrowser";
import { allRollViews, framesOfRoll } from "@/lib/catalog";

export const metadata: Metadata = { title: "Папки · plenka" };

export default function RollsPage() {
  const rolls: RollCard[] = allRollViews().map((r) => ({
    ...r,
    strip: framesOfRoll(r.id)
      .slice(0, 6)
      .map((f) => ({ id: f.id, w: f.w, h: f.h, color: f.color })),
  }));

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      <RollsBrowser rolls={rolls} />
    </div>
  );
}
