import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import RollDetail from "../../components/RollDetail";
import { ROLLS, framesOfRoll, rollDate, rollView } from "@/lib/catalog";

export function generateStaticParams() {
  return ROLLS.map((r) => ({ id: String(r.id) }));
}

export async function generateMetadata({ params }: PageProps<"/rolls/[id]">): Promise<Metadata> {
  const { id } = await params;
  const roll = ROLLS.find((r) => r.id === Number(id));
  return { title: roll ? `${rollView(roll).title} · [37exp]` : "Плёнка не найдена" };
}

export default async function RollPage({ params }: PageProps<"/rolls/[id]">) {
  const { id } = await params;
  const roll = ROLLS.find((r) => r.id === Number(id));
  if (!roll) notFound();

  const frames = framesOfRoll(roll.id);

  // соседние плёнки по дате
  const byDate = [...ROLLS].sort((a, b) => rollDate(a) - rollDate(b) || a.id - b.id);
  const at = byDate.findIndex((r) => r.id === roll.id);
  const prev = byDate[at - 1];
  const next = byDate[at + 1];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-40 md:px-5">
      <RollDetail roll={roll} frames={frames} />

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
