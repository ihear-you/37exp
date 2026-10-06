"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feedSrc, fullSrc, type Frame, type RollView } from "@/lib/catalog";
import { planFeed, plainItems, type FeedItem } from "@/lib/feed";
import { layoutMasonry } from "@/lib/masonry";
import { FolderIcon } from "./icons";
import Lightbox from "./Lightbox";

interface Props {
  /** Кадры уже в нужном порядке */
  frames: readonly Frame[];
  rolls: Record<number, RollView>;
  /** Лента: крупные кадры и клетки с подписью. Страница плёнки: ровная сетка */
  rhythm?: boolean;
  /** Кнопка-плёнка в углу кадра: нужна в ленте, а на странице самой плёнки ведёт «в никуда» */
  rollLink?: boolean;
  seed?: number;
  /** Смена значения раскладывает кадры заново и заново проигрывает их появление (режим, перемешивание) */
  resetKey?: string;
  /** Страница папки: в лайтбоксе появляется «Удалить» для кадра */
  onDeleteFrame?: (id: string) => void;
}

const DESKTOP = 768; // от этой ширины 4 колонки, ниже 2
const BIG_SRC = 640; // клетки шире этого берут крупную копию кадра, иначе он будет мутным

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

export default function Masonry({ frames, rolls, rhythm = false, rollLink = false, seed = 1, resetKey, onDeleteFrame }: Props) {
  const [ref, width] = useElementWidth();
  const [open, setOpen] = useState<number | null>(null);

  const desktop = width >= DESKTOP;
  const cols = desktop ? 4 : 2;
  const gap = 16;

  const layout = useMemo(() => {
    if (!width) return null;
    const items = rhythm ? planFeed(frames, cols, seed) : plainItems(frames);
    return layoutMasonry<FeedItem>(items, { cols, width, gap });
  }, [frames, width, cols, gap, rhythm, seed]);

  const indexById = useMemo(() => new Map(frames.map((f, i) => [f.id, i])), [frames]);
  const close = useCallback(() => setOpen(null), []);

  return (
    <div ref={ref} className="relative w-full" style={{ height: layout ? layout.height : "70vh" }}>
      <div key={resetKey} className="absolute inset-0">
        {layout?.placed.map(({ item, x, y, w, h }) => {
          const pos = { left: x, top: y, width: w, height: h };
          // лёгкий сдвиг по времени: кадры одной строки появляются не строго разом
          const delay = Math.round(x / (layout.colW + gap)) * 70;

          if (item.kind === "note") {
            const roll = rolls[item.roll ?? 0];
            return roll ? (
              <Reveal key={item.key} style={pos} delay={delay}>
                <NoteTile roll={roll} />
              </Reveal>
            ) : null;
          }

          const frame = item.frame!;
          const roll = rolls[frame.roll];
          return (
            <Reveal key={item.key} style={pos} delay={delay}>
              <button
                type="button"
                onClick={() => setOpen(indexById.get(frame.id) ?? 0)}
                aria-label={`${roll.title}, кадр ${frame.idx}: открыть на весь экран`}
                className="absolute inset-0 block cursor-zoom-in overflow-hidden rounded-frame transition-transform duration-200 hover:-translate-y-0.5"
                style={{
                  backgroundColor: frame.color,
                  boxShadow: frame.light > 0.6 ? "var(--frame-ring-light)" : "var(--frame-ring)",
                }}
              >
                <Image
                  src={w > BIG_SRC ? fullSrc(frame.id) : feedSrc(frame.id)}
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
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-[max(0px,calc(var(--round-frame)_-_0.375rem))] bg-paper/90 text-ink shadow-sm ring-1 ring-line backdrop-blur-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-ink hover:text-paper"
                >
                  <FolderIcon width={16} height={16} />
                </Link>
              )}
            </Reveal>
          );
        })}
      </div>

      {open !== null && <Lightbox frames={frames} rolls={rolls} index={open} onIndex={setOpen} onClose={close} onDelete={onDeleteFrame} />}
    </div>
  );
}

/**
 * Плавное появление: клетка невидима и чуть опущена, пока не попадёт в поле зрения,
 * потом проявляется и поднимается на место. Срабатывает один раз.
 * При включённом «уменьшении движения» переход мгновенный (см. globals.css).
 */
function Reveal({ children, style, delay }: { children: React.ReactNode; style: React.CSSProperties; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px" }, // чуть выше нижнего края, чтобы появление было видно
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="absolute"
      style={{
        ...style,
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(22px)",
        transition: "opacity 0.9s cubic-bezier(0.2, 0.6, 0.2, 1), transform 0.9s cubic-bezier(0.2, 0.6, 0.2, 1)",
        transitionDelay: shown ? `${delay}ms` : "0ms",
      }}
    >
      {children}
    </div>
  );
}

/** Пустая клетка ленты с подписью плёнки */
function NoteTile({ roll }: { roll: RollView }) {
  return (
    <Link
      href={`/rolls/${roll.id}`}
      className="group absolute inset-0 flex flex-col justify-end overflow-hidden rounded-frame bg-paper-deep p-3 ring-1 ring-line transition-colors hover:bg-paper-edge"
    >
      <span className="text-[15px] leading-snug text-ink-soft">{roll.title}</span>
      <span className="mt-1 text-[11px] uppercase tracking-[0.12em] text-ink-faint transition-colors group-hover:text-accent">
        открыть папку →
      </span>
    </Link>
  );
}
