import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Masonry from "../../components/Masonry";
import { ROLLS, findFilm, formatLabel, framesOfRoll, MONTHS, rollDate, rollView } from "@/lib/catalog";

export function generateStaticParams() {
  return ROLLS.map((r) => ({ id: String(r.id) }));
}

export async function generateMetadata({ params }: PageProps<"/rolls/[id]">): Promise<Metadata> {
  const { id } = await params;
  const roll = ROLLS.find((r) => r.id === Number(id));
  return { title: roll ? `${rollView(roll).title} · plenka` : "Плёнка не найдена" };
}

export default async function RollPage({ params }: PageProps<"/rolls/[id]">) {
  const { id } = await params;
  const roll = ROLLS.find((r) => r.id === Number(id));
  if (!roll) notFound();

  const view = rollView(roll);
  const film = findFilm(roll.filmId);
  const frames = framesOfRoll(roll.id);

  // соседние плёнки по дате
  const byDate = [...ROLLS].sort((a, b) => rollDate(a) - rollDate(b) || a.id - b.id);
  const at = byDate.findIndex((r) => r.id === roll.id);
  const prev = byDate[at - 1];
  const next = byDate[at + 1];

  const isoDiffers = film.iso && roll.iso && film.iso !== roll.iso;

  const facts: [string, string][] = [
    ["Камера", view.camera],
    ["Плёнка", view.film],
    ["ISO", roll.iso ? `${roll.iso}${isoDiffers ? ` (на плёнке ${film.iso})` : ""}` : "не указано"],
    ["Формат", formatLabel(roll.format)],
    ["Начало съёмки", `${MONTHS[roll.month - 1]} ${roll.year}`],
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-16 md:px-5">
      <header className="pb-8 pt-6 md:pb-10 md:pt-8">
        <Link href="/rolls" className="text-sm text-ink-faint transition-colors hover:text-ink">
          ← Все папки
        </Link>
        <h1 className="font-display mt-3 text-[26px] leading-[1.2] md:text-[40px]">{view.title}</h1>
        <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:max-w-md">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">{k}</dt>
                <dd className="mt-0.5 text-[15px]">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">Кадров</dt>
              <dd className="mt-0.5 text-[15px]">{frames.length}</dd>
            </div>
          </dl>
          {roll.description && <p className="max-w-prose text-[15px] leading-relaxed text-ink-soft">{roll.description}</p>}
        </div>
      </header>

      <Masonry frames={frames} rolls={{ [view.id]: view }} />

      <nav className="mt-14 flex items-center justify-between gap-4 border-t border-line pt-6 text-sm" aria-label="Соседние плёнки">
        {prev ? (
          <Link href={`/rolls/${prev.id}`} className="text-ink-soft transition-colors hover:text-accent">
            ← {rollView(prev).title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/rolls/${next.id}`} className="text-right text-ink-soft transition-colors hover:text-accent">
            {rollView(next).title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
