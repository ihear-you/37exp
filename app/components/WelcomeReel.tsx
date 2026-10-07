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
// цикла (у части он уже начинается не с нуля — restScale, будто путь начат раньше) и к
// концу уходят за границы экрана, будто камера ныряет сквозь стену фотографий на зрителя, —
// а на их месте тут же встаёт новое фото. Раскладка и первый цикл каждой плитки зависят
// только от фиксированного зерна, поэтому сервер и клиент рисуют одно и то же и гидрация не
// расходится. Рамка каждой плитки — реальные пропорции фото (aspect-ratio), кадрирования нет.
//
// Уход за границы — только за счёт роста, без отдельного движения вбок: плитка растёт вокруг
// точки, подобранной под неё (слева или справа от плитки, см. geometry), и сам рост выносит
// её за край; сдвиг к краю растёт вместе с масштабом, как при приближении камеры.
const SEED = 4242;

// Сколько секунд новое фото вплывает: проявляется из прозрачности и расфокуса и подрастает
// из уменьшенного (tile-appear в globals.css). Короче — выглядит как выскочило на месте.
const APPEAR_SECONDS = 0.4;

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
  .map((f) => ({
    id: f.id,
    src: feedSrc(f.id),
    color: f.color,
    alt: "",
    w: f.w,
    h: f.h,
  }));

interface Slot {
  left: number;
  top: number;
  baseWidth: number; // % ширины экрана в покое (до анимационного scale)
}

// Экран разбит на зоны ZONES×ZONES, в каждой — одна плитка со случайным смещением внутри
// зоны: гарантирует, что кадры покрывают весь экран, а не стягиваются к центру, но раскладка
// всё равно выглядит случайной, а не сеткой.
const ZONES = 4;
const ZONE_SLOTS: Slot[] = Array.from({ length: ZONES * ZONES }, (_, i) => {
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

// Плитки растут и уходят к краям, и центр экрана заселяется только в начале их циклов —
// с одними зонами он время от времени пустел. Поэтому в центре добавлено ещё несколько слотов.
const CENTER_EXTRA = 4;
const CENTER_SLOTS: Slot[] = Array.from({ length: CENTER_EXTRA }, (_, i) => {
  const rnd = mulberry32(SEED + 7000 + i * 131);
  const baseWidth = 12 + rnd() * 8;
  return {
    left: 30 + rnd() * (40 - baseWidth),
    top: 25 + rnd() * 30,
    baseWidth,
  };
});

const SLOTS: Slot[] = [...ZONE_SLOTS, ...CENTER_SLOTS];

interface Tile {
  photo: Pic;
  restScale: number; // с какого масштаба плитка начинает цикл — будто уже пролетела часть пути
  grow: number; // во сколько раз плитка вырастает за цикл — к концу она за границей экрана
  duration: number;
  delay: number; // только для первого цикла — отрицательная, чтобы он начался уже «в пути»
  z: number;
}

function rollTile(pool: Pic[], rnd: () => number): Tile {
  const restScale = 0.55 + rnd() * 0.75;
  return {
    photo: pool[Math.floor(rnd() * pool.length)],
    restScale,
    grow: 2.4 + rnd() * 1.8,
    duration: 3.2 + rnd() * 3.6,
    delay: 0,
    z: 1 + Math.floor(rnd() * 30),
  };
}

interface Geometry {
  left: number; // vw — левый край рамки в покое
  width: number; // vw — ширина рамки в покое
  originX: string; // откуда растёт: transform-origin по x
}

/** Всё считается в vw (ширина контейнера = 100vw, он на весь экран), поэтому по горизонтали
 * точно при любых пропорциях окна. Рамка в покое — baseWidth × restScale, по центру слота.
 *
 * Точка роста — слева от плитки (если её центр правее середины экрана) или справа от неё,
 * подобрана так, чтобы после роста в grow раз ближний к центру край упёрся ровно за границу
 * экрана (+ margin). Рост вокруг такой точки — это рост плюс смещение к краю, пропорциональное
 * росту, поэтому отдельного «съезда» в конце нет, а выход за край гарантирован. */
function geometry(slot: Slot, tile: Tile): Geometry {
  const margin = 2;
  const width = slot.baseWidth * tile.restScale;
  const cx = slot.left + slot.baseWidth / 2;
  const left = cx - width / 2;
  const { grow } = tile;
  const originAbs =
    cx >= 50
      ? (grow * left - 100 - margin) / (grow - 1)
      : (grow * (left + width) + margin) / (grow - 1);
  return { left, width, originX: `${originAbs - left}vw` };
}

export default function WelcomeReel({ photos }: { photos: EditorialPhoto[] }) {
  const pool = useMemo<Pic[]>(
    () =>
      photos.length > 0
        ? shuffled(
            photos.map((p) => ({
              id: p.id,
              src: p.src,
              color: p.color,
              alt: p.alt,
              w: p.w,
              h: p.h,
            })),
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
        <p className="max-w-sm text-ink-soft">
          Соберите архив и смотрите кадры в удобном формате
        </p>
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

/** Одна ячейка коллажа: стоит на своём месте и плавно растёт весь цикл, в конце уходит за
 * границы экрана — и тут же возвращается на то же место с новым фото. Всё движение — один
 * рост (scale) одного элемента, отдельного смещения нет (см. geometry). */
function Cell({
  index,
  slot,
  pool,
}: {
  index: number;
  slot: Slot;
  pool: Pic[];
}) {
  // Первый цикл детерминированный (общий SEED), а фазы старта у плиток разнесены равномерно
  // (золотое сечение по индексу, не дальше 80% цикла) через отрицательную задержку: к заходу
  // на сайт плитки уже в пути на разных стадиях, а не стартуют разом — иначе все они
  // заканчивали первый короткий цикл одновременно и экран на секунду пустел. Дальше
  // (onAnimationEnd — уже только в браузере) циклы по-настоящему случайные, и плитки
  // не синхронизируются.
  const [tile, setTile] = useState<Tile>(() => {
    const t = rollTile(pool, mulberry32(SEED + index * 733));
    return { ...t, delay: -(((index * 0.618034) % 1) * 0.8 * t.duration) };
  });

  const g = geometry(slot, tile);

  return (
    // Внешний элемент — позиция и появление (вплывает и проявляется вокруг своего центра),
    // внутренний — рост за цикл вокруг подобранной точки. key — на внешнем, чтобы при смене
    // кадра перезапускались обе анимации.
    <div
      key={`${tile.photo.id}-${tile.duration}`}
      className="tile-appear absolute overflow-visible"
      style={{
        left: `${g.left}%`,
        top: `${slot.top}%`,
        width: `${g.width}%`,
        zIndex: tile.z,
        animationDuration: `${APPEAR_SECONDS}s`,
        animationDelay: `${tile.delay}s`,
      }}
    >
      <div
        className="tile-burst relative w-full"
        style={
          {
            aspectRatio: `${tile.photo.w} / ${tile.photo.h}`,
            transformOrigin: `${g.originX} 50%`,
            "--grow": tile.grow,
            backgroundColor: tile.photo.color,
            animationDuration: `${tile.duration}s`,
            animationDelay: `${tile.delay}s`,
          } as React.CSSProperties
        }
        onAnimationEnd={() => setTile(rollTile(pool, Math.random))}
      >
        <Image
          src={tile.photo.src}
          alt={tile.photo.alt}
          fill
          unoptimized
          sizes="20vw"
          className="object-contain"
        />
      </div>
    </div>
  );
}
