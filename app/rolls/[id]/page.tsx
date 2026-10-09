import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import RollDetail from "../../components/RollDetail";
import { getViewer } from "@/lib/auth/session";
import { readShareKeys } from "@/lib/auth/shares";
import { rollDate, rollView } from "@/lib/catalog";
import { getRollForViewer } from "@/lib/db";

// Плёнку видит автор, а остальные только если она открыта всем или они пришли по ссылке /s/<ключ>.
// Если прав нет, отвечаем так же, как если бы плёнки не было.

export async function generateMetadata({ params }: PageProps<"/rolls/[id]">): Promise<Metadata> {
  const [{ id }, viewer, keys] = await Promise.all([params, getViewer(), readShareKeys()]);
  const page = await getRollForViewer(Number(id), viewer?.id ?? null, keys);
  if (!page) return { title: "Плёнка не найдена" };
  const title = rollView(page.roll, page.cameras, page.frames.length, page.films).title;
  // закрытые от списков плёнки в поиск не попадают
  return { title: `${title} · [37exp]`, robots: page.roll.visibility === "public" ? undefined : { index: false, follow: false } };
}

export default async function RollPage({ params }: PageProps<"/rolls/[id]">) {
  const [{ id }, viewer, keys] = await Promise.all([params, getViewer(), readShareKeys()]);
  const page = await getRollForViewer(Number(id), viewer?.id ?? null, keys);
  if (!page) notFound();
  const { roll, frames, cameras, films, siblings, isOwner, ownerHandle } = page;

  // соседние плёнки по дате (из тех, что зритель вправе видеть)
  const byDate = [...siblings].sort((a, b) => rollDate(a) - rollDate(b) || a.id - b.id);
  const at = byDate.findIndex((r) => r.id === roll.id);
  const prev = byDate[at - 1];
  const next = byDate[at + 1];

  // с чужой плёнки «назад» ведёт на страницу автора, но только если плёнка открыта всем
  const backHref = isOwner ? "/rolls" : roll.visibility === "public" ? `/u/${ownerHandle}` : undefined;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-40 md:px-5">
      <RollDetail roll={roll} frames={frames} cameras={cameras} films={films} canEdit={isOwner} backHref={backHref} />

      <nav className="mt-14 flex items-center justify-between gap-4 border-t border-line pt-6 text-sm" aria-label="Соседние плёнки">
        {prev ? (
          <Link href={`/rolls/${prev.id}`} className="text-ink-soft transition-colors hover:text-accent">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/rolls/${next.id}`} className="text-right text-ink-soft transition-colors hover:text-accent">
            {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
