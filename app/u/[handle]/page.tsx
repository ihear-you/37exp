import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RollsBrowser, { type RollCard } from "../../components/RollsBrowser";
import { getPublicProfile } from "@/lib/db";

// Страница автора: плёнки, открытые всем. Плёнки «по ссылке» и «только я» здесь не видны.

export async function generateMetadata({ params }: PageProps<"/u/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getPublicProfile(handle, 0);
  return { title: profile ? `${profile.user.name} · [37exp]` : "Страница не найдена" };
}

export default async function AuthorPage({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  const profile = await getPublicProfile(handle, 6);
  if (!profile) notFound();

  const rolls: RollCard[] = profile.rolls.map((r) => ({
    ...r,
    strip: (profile.previews[r.id] ?? []).map((f) => ({ id: f.id, w: f.w, h: f.h, color: f.color })),
  }));

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5">
      <h1 className="pt-6 text-[26px] leading-tight md:pt-8 md:text-[36px]">{profile.user.name}</h1>
      {rolls.length > 0 ? (
        <RollsBrowser rolls={rolls} />
      ) : (
        <p className="mt-4 text-ink-soft">Пока нет открытых плёнок.</p>
      )}
    </div>
  );
}
