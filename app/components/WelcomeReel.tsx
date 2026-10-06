"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FRAMES, feedSrc } from "@/lib/catalog";
import { mulberry32, shuffled } from "@/lib/rand";
import type { EditorialPhoto } from "@/lib/unsplash";
import { UploadIcon } from "./icons";

// Пустая лента: хаотичный коллаж фотографий внахлёст, без сетки и без поворота, размазанный
// по всему экрану (зоны ниже), а не собранный в центре. Начиная с захода на сайт и дальше
// непрерывно, отдельные плитки по очереди «взлетают» — плавно растут в течение всего своего
// цикла (у части он уже начинается не с нуля — restScale, будто путь начат раньше) и под
// конец рывком вылетают за экран, будто камера ныряет сквозь стену фотографий на зрителя, —
// а на их месте тут же встаёт новое фото в исходном размере. Раскладка и первый цикл каждой
// плитки зависят только от фиксированного зерна, поэтому сервер и клиент рисуют одно и то же
// и гидрация не расходится. Рамка каждой плитки — реальные пропорции фото (aspect-ratio),
// кадрирования нет.
const SEED = 4242;

interface Pic {
  id: string;
  src: string;
  color: string;
  alt: string;
  w: number;
  h: number;
}

const fallbackPics: Pic[] = shuffled(FRAMES, SEED)
  .slice(0, 30)
  .map((f) => ({ id: f.id, src: feedSrc(f.id), color: f.color, alt: "", w: f.w, h: f.h }));

interface Slot {
  left: number;
  top: number;
  baseWidth: number; // % ширины экрана в покое (до анимационного scale)
}

// Экран разбит на зоны ZONES×ZONES, в каждой — одна плитка со случайным смещением внутри
// зоны: гарантирует, что кадры покрывают весь экран, а не стягиваются к центру, но раскладка
// всё равно выглядит случайной, а не сеткой.
const ZONES = 4;
const SLOTS: Slot[] = Array.from({ length: ZONES * ZONES }, (_, i) => {
  const rnd = mulberry32(SEED + i * 911);
  const zoneW = 100 / ZONES;
  const zoneH = 100 / ZONES;
  const zoneLeft = (i % ZONES) * zoneW;
  const zoneTop = Math.floor(i / ZONES) * zoneH;
  const baseWidth = 11 + rnd() * 9;
  const left = zoneLeft + rnd() * (zoneW - baseWidth * 0.5) - baseWidth * 0.15;
  const top = zoneTop + rnd() * (zoneH - baseWidth * 0.5) - baseWidth * 0.15;
  return { left, top, baseWidth };
});

interface Tile {
  photo: Pic;
  restScale: number; // с какого масштаба плитка начинает цикл — будто уже пролетела часть пути
  burstScale: number; // во сколько раз вырастает к концу цикла, когда улетает за экран
  duration: number;
  z: number;
}

function rollTile(pool: Pic[], rnd: () => number): Tile {
  const restScale = 0.55 + rnd() * 0.75;
  return {
    photo: pool[Math.floor(rnd() * pool.length)],
    restScale,
    burstScale: restScale + 1.7 + rnd() * 1.6,
    duration: 3.2 + rnd() * 3.6,
    z: 1 + Math.floor(rnd() * 30),
  };
}

/** Точка схождения — центр экрана: плитка растёт не сама из себя, а будто разлетается от
 * общего центра композиции, поэтому transform-origin для каждой считаем по её позиции
 * в раскладке, а не берём center по умолчанию (baseWidth — грубая, но достаточная оценка
 * и для высоты: точную высоту заранее не знаем, она зависит от пропорций текущего фото). */
function originFor(slot: Slot): string {
  const ox = ((50 - slot.left) / slot.baseWidth) * 100;
  const oy = ((50 - slot.top) / slot.baseWidth) * 100;
  return `${ox}% ${oy}%`;
}

export default function WelcomeReel({ photos }: { photos: EditorialPhoto[] }) {
  const pool = useMemo<Pic[]>(
    () =>
      photos.length > 0
        ? shuffled(
            photos.map((p) => ({ id: p.id, src: p.src, color: p.color, alt: p.alt, w: p.w, h: p.h })),
            SEED,
          )
        : fallbackPics,
    [photos],
  );

  const credit = photos[0]?.credit;

  return (
    // fixed на весь экран, а не только под хедером: хедер здесь прозрачный (см. SiteHeader.tsx,
    // useIsWelcomeScreen), и фотографии должны залетать в том числе в его область, а не
    // останавливаться у верхней границы.
    <div className="fixed inset-0 h-dvh w-full overflow-hidden bg-black">
      <div className="absolute inset-0" aria-hidden>
        {SLOTS.map((slot, i) => (
          <Cell key={i} index={i} slot={slot} pool={pool} />
        ))}
      </div>

      {/* Полоса с текстом и кнопкой: не часть композиции, поэтому лежит поверх на своём фоне-скриме */}
      <div className="absolute inset-x-0 bottom-0 z-40 flex flex-col items-center bg-gradient-to-t from-black via-black/85 to-transparent px-4 pb-[52px] pt-28 text-center sm:pb-[60px]">
        <p className="max-w-sm text-ink-soft">Соберите архив и смотрите кадры в удобном формате</p>
        <Link
          href="/upload"
          className="mt-5 flex items-center gap-1.5 rounded-control bg-ink px-6 py-2.5 text-sm text-paper transition-opacity hover:opacity-85"
        >
          <UploadIcon width={16} height={16} />
          Загрузить первую плёнку
        </Link>
      </div>

      {/* Подпись Unsplash — в правом нижнем углу, с тем же отступом от края, что у логотипа слева */}
      {credit && (
        <a
          href="https://unsplash.com/?utm_source=photo-lab&utm_medium=referral"
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-3 right-0 z-40 px-3 text-[11px] text-ink-faint transition-colors hover:text-ink-soft md:px-5"
        >
          Фото сообщества Unsplash
        </a>
      )}
    </div>
  );
}

/** Одна ячейка коллажа: стоит на своём месте, раз в несколько секунд плавно растёт весь цикл
 * и под конец резко улетает за экран, — и тут же возвращается на то же место с новым фото. */
function Cell({ index, slot, pool }: { index: number; slot: Slot; pool: Pic[] }) {
  // Первый цикл короткий и детерминированный (общий SEED): вскоре после захода на сайт
  // почти все плитки взлетают почти разом — тот самый эффект «влетаем в стену фотографий»
  // в момент открытия. Дальше (onAnimationEnd — уже только в браузере) циклы куда длиннее
  // и по-настоящему случайные, чтобы взлёты не совпадали и лента жила непрерывно и вразнобой.
  const [tile, setTile] = useState<Tile>(() => {
    const rnd = mulberry32(SEED + index * 733);
    const t = rollTile(pool, rnd);
    return { ...t, duration: 0.7 + rnd() * 1.3 };
  });

  return (
    <div className="absolute overflow-visible" style={{ left: `${slot.left}%`, top: `${slot.top}%`, width: `${slot.baseWidth}%`, zIndex: tile.z }}>
      <div
        key={`${tile.photo.id}-${tile.duration}`}
        className="tile-burst relative w-full"
        style={
          {
            aspectRatio: `${tile.photo.w} / ${tile.photo.h}`,
            transformOrigin: originFor(slot),
            "--rest-scale": tile.restScale,
            "--burst-scale": tile.burstScale,
            animationDuration: `${tile.duration}s`,
            backgroundColor: tile.photo.color,
          } as React.CSSProperties
        }
        onAnimationEnd={() => setTile(rollTile(pool, Math.random))}
      >
        <Image src={tile.photo.src} alt={tile.photo.alt} fill unoptimized sizes="20vw" className="object-contain" />
      </div>
    </div>
  );
}
