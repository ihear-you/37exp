// Фото для WelcomeReel (см. app/components/WelcomeReel.tsx), когда лента пуста.
// Серверный запрос: ключ не должен попасть в клиентский бандл.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Motion blur — тематически в точку для WelcomeReel: кадры и так постоянно летят и
// разгоняются, смазанные в движении фото только усиливают этот эффект. Один запрос, а не
// несколько: демо-ключ Unsplash даёт всего 50 запросов в час, и их легко исчерпать за
// разработку — а кэш ниже (сутки, не час) держит их подольше.
const QUERIES = ["motion blur"];

export interface EditorialPhoto {
  id: string;
  src: string;
  w: number;
  h: number;
  color: string;
  alt: string;
  credit: { name: string; url: string };
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  color: string | null;
  alt_description: string | null;
  urls: { raw: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

async function searchQuery(query: string, key: string, perPage: number): Promise<UnsplashPhoto[]> {
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${key}` }, next: { revalidate: 86400 } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { results: UnsplashPhoto[] };
  return data.results;
}

async function loadEditorialPhotos(perQuery: number): Promise<EditorialPhoto[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];

  try {
    const batches = await Promise.all(QUERIES.map((q) => searchQuery(q, key, perQuery)));
    const seen = new Set<string>();
    const photos = batches.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    if (photos.length === 0) return [];

    // Обязательное условие API Unsplash: засчитать показ как «использование» фото
    void Promise.allSettled(
      photos.map((p) => fetch(p.links.download_location, { headers: { Authorization: `Client-ID ${key}` } })),
    );

    return photos.map((p) => ({
      id: p.id,
      // Крупнее, чем нужно для показа в покое: плитки в WelcomeReel разгоняются в несколько
      // раз через CSS scale(), и при недостаточном разрешении исходника это выглядит как
      // размытие. 1200 — компромисс с весом: в покое хватает с большим запасом, а в самом
      // конце разгона на Retina-ноутбуке кадр растянут примерно вдвое, но к этому моменту он
      // уже уходит в прозрачность. Замер: w=1600 — 169 КБ в среднем, w=1200 — ~97 КБ.
      src: `${p.urls.raw}&w=1200&q=70&fm=jpg&fit=max`,
      w: p.width,
      h: p.height,
      color: p.color ?? "#d9d9d9",
      alt: p.alt_description ?? "",
      credit: { name: p.user.name, url: `${p.user.links.html}?utm_source=photo-lab&utm_medium=referral` },
    }));
  } catch {
    return [];
  }
}

// Результат держим в памяти и на диске (рядом с базой): без кэша каждый заход слал бы в Unsplash
// запрос «засчитать показ» на каждое фото, а перезапуск сайта (деплой) заново тратил бы лимит
// демо-ключа в 50 запросов в час. Свежий файл читается без обращения к Unsplash вообще.
const OK_TTL = 24 * 60 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000; // пусто (ошибка или лимит): пробуем снова не чаще раза в 5 минут
const CACHE_FILE = path.join(
  path.dirname(process.env.PLENKA_DB_PATH ?? path.join(process.cwd(), "data", "plenka.db")),
  "unsplash-cache.json",
);

interface DiskCache {
  at: number;
  perQuery: number;
  photos: EditorialPhoto[];
}

async function readDisk(perQuery: number): Promise<DiskCache | null> {
  try {
    const c = JSON.parse(await readFile(CACHE_FILE, "utf8")) as DiskCache;
    return c.perQuery === perQuery && Array.isArray(c.photos) && c.photos.length > 0 ? c : null;
  } catch {
    return null;
  }
}

async function writeDisk(c: DiskCache) {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(c));
    await rename(tmp, CACHE_FILE);
  } catch {
    // не записалось: кэш в памяти всё равно работает
  }
}

let cached: { at: number; ttl: number; perQuery: number; photos: EditorialPhoto[] } | null = null;
let inflight: Promise<EditorialPhoto[]> | null = null;

async function refresh(perQuery: number): Promise<EditorialPhoto[]> {
  const disk = await readDisk(perQuery);
  if (disk && Date.now() - disk.at < OK_TTL) {
    cached = { at: disk.at, ttl: OK_TTL, perQuery, photos: disk.photos };
    return disk.photos;
  }
  const fresh = await loadEditorialPhotos(perQuery);
  if (fresh.length > 0) {
    const at = Date.now();
    cached = { at, ttl: OK_TTL, perQuery, photos: fresh };
    await writeDisk({ at, perQuery, photos: fresh });
    return fresh;
  }
  // Unsplash не ответил (ошибка или лимит): лучше устаревшие фото, чем пустая заставка
  const photos = disk?.photos ?? [];
  cached = { at: Date.now(), ttl: FAIL_TTL, perQuery, photos };
  return photos;
}

/** Пусто, если ключа нет и кэша тоже; вызывающий код подставит запасной вариант.
 * Пул 20, а не 30: на первом экране плитки берут ~12 разных кадров, а за первые секунды после
 * первой смены в плитки попадает почти весь пул — лишние кадры только грузят канал. */
export async function getEditorialPhotos(perQuery = 20): Promise<EditorialPhoto[]> {
  if (!process.env.UNSPLASH_ACCESS_KEY) return [];
  if (cached && cached.perQuery === perQuery && Date.now() - cached.at < cached.ttl) return cached.photos;
  inflight ??= refresh(perQuery).finally(() => {
    inflight = null;
  });
  return inflight;
}
