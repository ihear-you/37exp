import Image from "next/image";
import Link from "next/link";
import { FRAMES, feedSrc } from "@/lib/catalog";
import { shuffled } from "@/lib/rand";
import type { EditorialPhoto } from "@/lib/unsplash";
import { UploadIcon } from "./icons";

// Редакционная фотомозаика для пустой ленты: чёрный фон, ряды и колонны фотографий едут
// без остановки — влево/вправо, вверх/вниз, без вращения и без зумов. Раскладка и порядок
// зависят только от фиксированного зерна, а сама анимация — чистый CSS (без React-таймеров),
// поэтому сервер и клиент рисуют одно и то же и гидрация не расходится.
const SEED = 4242;

interface Pic {
  id: string;
  src: string;
  color: string;
  alt: string;
}

const fallbackPics: Pic[] = shuffled(FRAMES, SEED)
  .slice(0, 24)
  .map((f) => ({ id: f.id, src: feedSrc(f.id), color: f.color, alt: "" }));

// Горизонтальные ленты во всю ширину, разной высоты (сумма — 100%), едут в разные стороны
// с разной скоростью, чтобы ритм не совпадал и коллаж не выглядел механическим.
const ROWS = [
  { height: 17, dir: "left", duration: 34 },
  { height: 15, dir: "right", duration: 27 },
  { height: 19, dir: "left", duration: 40 },
  { height: 14, dir: "right", duration: 24 },
  { height: 18, dir: "left", duration: 36 },
  { height: 17, dir: "right", duration: 30 },
] as const;

// Ширины кадров одного прохода ленты (vw — доля от экрана, а не от самой ленты).
const ROW_WIDTHS = [21, 15, 27, 13, 19, 24, 16];
const ROW_SHIFT = ROW_WIDTHS.reduce((a, b) => a + b, 0);

// Вертикальные колонны поверх лент — источник вертикального движения и лёгкого нахлёста.
const LANES = [
  { left: 24, width: 17, dir: "up", duration: 32 },
  { left: 61, width: 16, dir: "down", duration: 38 },
] as const;

const LANE_HEIGHTS = [20, 14, 24, 16, 22, 18];
const LANE_SHIFT = LANE_HEIGHTS.reduce((a, b) => a + b, 0);

export default function WelcomeReel({ photos }: { photos: EditorialPhoto[] }) {
  const pool: Pic[] =
    photos.length > 0
      ? shuffled(
          photos.map((p) => ({ id: p.id, src: p.src, color: p.color, alt: p.alt })),
          SEED,
        )
      : fallbackPics;

  const credit = photos[0]?.credit;

  // Каждому кадру во всех лентах и колоннах — своя фотография из пула, по порядку,
  // без общего мутируемого счётчика: индекс просто продолжается от предыдущей строки.
  const pic = (index: number) => pool[index % pool.length];
  const rowTops = ROWS.map((_, i) => ROWS.slice(0, i).reduce((sum, r) => sum + r.height, 0));

  return (
    <div className="relative h-[calc(100dvh-5rem)] w-full overflow-hidden bg-black">
      <div className="absolute inset-0" aria-hidden>
        {ROWS.map((row, ri) => {
          const top = rowTops[ri];
          const tiles = ROW_WIDTHS.map((w, wi) => ({ w, pic: pic(ri * ROW_WIDTHS.length + wi) }));

          return (
            <div key={ri} className="absolute inset-x-0 overflow-hidden" style={{ top: `${top}%`, height: `${row.height}%` }}>
              <div
                className="marquee-x flex h-full"
                style={
                  {
                    "--shift": `${ROW_SHIFT}vw`,
                    animationDuration: `${row.duration}s`,
                    animationDirection: row.dir === "right" ? "reverse" : "normal",
                  } as React.CSSProperties
                }
              >
                {[...tiles, ...tiles].map((t, i) => (
                  <div key={i} className="relative h-full shrink-0" style={{ width: `${t.w}vw`, backgroundColor: t.pic.color }}>
                    <Image src={t.pic.src} alt={t.pic.alt} fill unoptimized sizes="25vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute inset-0 hidden sm:block" aria-hidden>
        {LANES.map((lane, li) => {
          const base = ROWS.length * ROW_WIDTHS.length + li * LANE_HEIGHTS.length;
          const tiles = LANE_HEIGHTS.map((h, hi) => ({ h, pic: pic(base + hi) }));

          return (
            <div
              key={li}
              className="absolute inset-y-0 z-[5] overflow-hidden"
              style={{ left: `${lane.left}vw`, width: `${lane.width}vw` }}
            >
              <div
                className="marquee-y flex w-full flex-col"
                style={
                  {
                    "--shift": `${LANE_SHIFT}vh`,
                    animationDuration: `${lane.duration}s`,
                    animationDirection: lane.dir === "down" ? "reverse" : "normal",
                  } as React.CSSProperties
                }
              >
                {[...tiles, ...tiles].map((t, i) => (
                  <div key={i} className="relative w-full shrink-0" style={{ height: `${t.h}vh`, backgroundColor: t.pic.color }}>
                    <Image src={t.pic.src} alt={t.pic.alt} fill unoptimized sizes="18vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Полоса с текстом и кнопкой: не часть мозаики, поэтому лежит поверх на своём фоне-скриме */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center bg-gradient-to-t from-black via-black/85 to-transparent px-4 pb-8 pt-28 text-center sm:pb-10">
        <p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">Пока пусто</p>
        <p className="mt-2 max-w-sm text-ink-soft">Загрузите первую плёнку — и лента начнётся с неё.</p>
        <Link
          href="/upload"
          className="mt-5 flex items-center gap-1.5 rounded-full bg-ink px-6 py-2.5 text-sm text-paper transition-opacity hover:opacity-85"
        >
          <UploadIcon width={16} height={16} />
          Загрузить кадры
        </Link>
        {credit && (
          <a
            href="https://unsplash.com/?utm_source=photo-lab&utm_medium=referral"
            target="_blank"
            rel="noreferrer"
            className="mt-6 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
          >
            Фото сообщества Unsplash
          </a>
        )}
      </div>
    </div>
  );
}
