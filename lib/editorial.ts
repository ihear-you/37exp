// Фото для заставки (WelcomeReel) и веера над плитками загрузки (пустые «Папки», /upload).
// Лежат на самом сайте, в public/editorial, список с авторами — editorial.json. Раньше сайт брал их из API Unsplash
// и показывал прямо с images.unsplash.com, но оттуда из России без VPN картинки не открываются, и вместо фото
// оставались цветные квадраты. Обновить подборку: npm run editorial -- <id> … (scripts/editorial-photos.mjs).

import list from "./editorial.json";

export interface EditorialPhoto {
  id: string;
  src: string;
  w: number;
  h: number;
  color: string;
  alt: string;
  /** Насколько фото цветастое: 0 — ч/б, 80+ — очень яркое (считает scripts/editorial-photos.mjs по пикселям) */
  vivid: number;
  credit: { name: string; url: string };
}

const PHOTOS = list as EditorialPhoto[];

/** Все фото подборки; async — чтобы страницам не было разницы, откуда они берутся */
export async function getEditorialPhotos(): Promise<EditorialPhoto[]> {
  return PHOTOS;
}

/**
 * Четыре фото для веера над плитками загрузки: первые четыре подборки, только по краям — два самых цветастых
 * из остальных (левое — самое яркое), если они ярче стоящих там: с тёмными кадрами по краям веер выглядел скучно
 */
export async function getFanPhotos(): Promise<{ id: string; src: string; color: string }[]> {
  const fan = PHOTOS.slice(0, 4);
  const bright = PHOTOS.slice(4).sort((a, b) => b.vivid - a.vivid);
  for (const [at, p] of [[0, bright[0]], [fan.length - 1, bright[1]]] as const) {
    if (p && fan[at] && p.vivid > fan[at].vivid) fan[at] = p;
  }
  return fan.map((p) => ({ id: p.id, src: p.src, color: p.color }));
}
