"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feedSrc, type Frame, type RollView } from "@/lib/catalog";
import { planFeed, plainItems, type FeedItem } from "@/lib/feed";
import { layoutMasonry } from "@/lib/masonry";
import { FilmIcon } from "./icons";
import Lightbox from "./Lightbox";

interface Props {
  /** Кадры уже в нужном порядке */
  frames: readonly Frame[];
  rolls: Record<number, RollView>;
  /** Лента: широкие кадры и пустые клетки. Страница плёнки: ровная сетка */
  rhythm?: boolean;
  /** Кнопка-плёнка в углу кадра: нужна в ленте, а на странице самой плёнки ведёт «в никуда» */
  rollLink?: boolean;
  seed?: number;
  /** Смена значения заново проигрывает появление кадров (режим, перемешивание) */
  resetKey?: string;
}

const DESKTOP = 768; // от этой ширины 4 колонки, ниже 2

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function Masonry({ frames, rolls, rhythm = false, rollLink = false, seed = 1, resetKey }: Props) {
  const [ref, width] = useElementWidth();
  const [open, setOpen] = useState<number | null>(null);

  const desktop = width >= DESKTOP;
  const cols = desktop ? 4 : 2;
  const gap = desktop ? 14 : 8;

  const layout = useMemo(() => {
    if (!width) return null;
    const items = rhythm ? planFeed(frames, cols, seed) : plainItems(frames);
    return layoutMasonry<FeedItem>(items, { cols, width, gap });
  }, [frames, width, cols, gap, rhythm, seed]);

  const indexById = useMemo(() => new Map(frames.map((f, i) => [f.id, i])), [frames]);
  const close = useCallback(() => setOpen(null), []);

  return (
    <div ref={ref} className="relative w-full" style={{ height: layout ? layout.height : "70vh" }}>
      <div key={resetKey} className="absolute inset-0" style={{ animation: resetKey ? "fade-in .35s ease-out" : undefined }}>
      {layout?.placed.map(({ item, x, y, w, h }) => {
        const pos = { left: x, top: y, width: w, height: h };
        if (item.kind === "note") {
          const roll = rolls[item.roll ?? 0];
          return roll ? <NoteTile key={item.key} roll={roll} style={pos} /> : null;
        }
        const frame = item.frame!;
        const roll = rolls[frame.roll];
        return (
          <div key={item.key} className="absolute" style={pos}>
            <button
              type="button"
              onClick={() => setOpen(indexById.get(frame.id) ?? 0)}
              aria-label={`${roll.title}, кадр ${frame.idx}: открыть на весь экран`}
              className="absolute inset-0 block cursor-zoom-in overflow-hidden rounded-[2px] transition-transform duration-200 hover:-translate-y-0.5"
              style={{
                backgroundColor: frame.color,
                boxShadow: frame.light > 0.6 ? "var(--frame-ring-light)" : "var(--frame-ring)",
              }}
            >
              <Image
                src={feedSrc(frame.id)}
                alt=""
                fill
                unoptimized
                sizes={`${Math.round(w)}px`}
                className="object-cover"
              />
            </button>
            {rollLink && (
              <Link
                href={`/rolls/${roll.id}`}
                title={roll.title}
                aria-label={`Плёнка: ${roll.title}`}
                className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-paper/90 text-ink shadow-sm ring-1 ring-black/10 backdrop-blur-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-ink hover:text-paper"
              >
                <FilmIcon width={16} height={16} />
              </Link>
            )}
          </div>
        );
      })}
      </div>

      {open !== null && (
        <Lightbox frames={frames} rolls={rolls} index={open} onIndex={setOpen} onClose={close} />
      )}
    </div>
  );
}

/** Пустая клетка ленты с подписью плёнки */
function NoteTile({ roll, style }: { roll: RollView; style: React.CSSProperties }) {
  return (
    <Link
      href={`/rolls/${roll.id}`}
      className="group absolute flex flex-col justify-end overflow-hidden rounded-[2px] bg-paper-deep p-3 ring-1 ring-line transition-colors hover:bg-paper-edge"
      style={style}
    >
      <FilmIcon className="absolute left-3 top-3 text-ink-faint" width={16} height={16} />
      <span className="font-display text-[15px] leading-snug text-ink-soft">{roll.title}</span>
      <span className="mt-1 text-[11px] uppercase tracking-[0.12em] text-ink-faint transition-colors group-hover:text-accent">
        {roll.count} кадров · открыть →
      </span>
    </Link>
  );
}
