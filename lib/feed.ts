// Как собирается лента: обычный случайный порядок, иногда — с тёплым или холодным уклоном.
// Уклон ничего не отбирает (все кадры остаются в ленте) — кадры одного тона просто чуть чаще
// оказываются рядом, как если бы кто-то на глаз разложил кадры, а не отдельным «режимом».
// Выбирается один раз на загрузку страницы, вместе с seed (см. app/components/Feed.tsx).

import type { Frame } from "./catalog";
import { mulberry32, shuffledBy } from "./rand";

// Порядок не должен перетасовываться, когда кадр удалили прямо из ленты: место кадра зависит только от него
const shuffleFrames = (frames: readonly Frame[], seed: number) => shuffledBy(frames, seed, (f) => f.id);

const isColor = (f: Frame) => f.sat >= 0.12;
const isWarm = (f: Frame) => isColor(f) && (f.hue <= 75 || f.hue >= 330);
const isCold = (f: Frame) => isColor(f) && f.hue >= 90 && f.hue <= 290; // зелёный, голубой, синий, фиолетовый

export type Tint = "none" | "warm" | "cold";

// Как часто лента при загрузке выбирает уклон вместо обычного перемешивания.
const TINT_CHANCE: Record<Tint, number> = { none: 0.55, warm: 0.225, cold: 0.225 };
// Насколько чаще подряд идёт кадр того же тона, чем при обычной случайности (0.5 — как без уклона).
const TINT_WEIGHT = 0.68;

export function pickTint(seed: number): Tint {
  const r = mulberry32(seed)();
  if (r < TINT_CHANCE.none) return "none";
  return r < TINT_CHANCE.none + TINT_CHANCE.warm ? "warm" : "cold";
}

/** Обычный случайный порядок или лёгкий уклон в тон — без потери кадров. */
export function orderFrames(frames: readonly Frame[], seed: number, tint: Tint): Frame[] {
  if (tint === "none") return shuffleFrames(frames, seed);
  const match = tint === "warm" ? isWarm : isCold;
  const tinted = shuffleFrames(frames.filter(match), seed);
  const rest = shuffleFrames(frames.filter((f) => !match(f)), seed + 1);
  const rnd = mulberry32(seed + 2);
  const out: Frame[] = [];
  let i = 0;
  let j = 0;
  while (i < tinted.length || j < rest.length) {
    const takeTinted = j >= rest.length || (i < tinted.length && rnd() < TINT_WEIGHT);
    out.push(takeTinted ? tinted[i++] : rest[j++]);
  }
  return out;
}

// ── ритм ленты: крупные кадры и клетки с подписью плёнки ──

export interface FeedItem {
  key: string;
  ratio: number;
  /** Сколько колонок занимает */
  span: 1 | 2 | 3;
  /** frame: кадр; note: клетка с подписью плёнки */
  kind: "frame" | "note";
  frame?: Frame;
  /** У клетки с подписью: чья это плёнка */
  roll?: number;
}

/**
 * Ритм ленты. Тот же seed даёт ту же раскладку.
 * - Главный кадр: редко один кадр заметно крупнее остальных. На десктопе горизонтальный занимает
 *   три колонки из четырёх, вертикальный две (и получается высоким). На телефоне это всю ширину.
 * - Широкий кадр: горизонтальный на две колонки, не подряд.
 * - Клетка с подписью: совсем редкая, называет плёнку.
 * Часть крупных кадров в сетке станет обычными, если рядом не найдётся ровных колонок (см. masonry.ts).
 */
export function planFeed(frames: readonly Frame[], cols: number, seed: number): FeedItem[] {
  const rnd = mulberry32(seed ^ 0x9e3779b1 ^ (cols * 7919));
  const desk = cols >= 4;

  const bigChance = desk ? 0.13 : 0.07;
  const bigGap = desk ? 9 : 12; // сколько кадров минимум между двумя главными
  const wideChance = desk ? 0.25 : 0.18;
  const wideGap = desk ? 3 : 6; // сколько кадров минимум между двумя крупными любого рода
  const noteChance = 0.05;
  const noteGap = 14;

  const items: FeedItem[] = [];
  let sinceBig = bigGap;
  let sinceWide = wideGap;
  let sinceNote = 0;

  for (const f of frames) {
    const ratio = f.w / f.h;
    const landscape = ratio >= 1.2;

    let span: 1 | 2 | 3 = 1;
    let big = false;
    if (sinceBig >= bigGap && rnd() < bigChance) {
      big = true;
      span = desk && landscape ? 3 : 2;
    } else if (landscape && sinceWide >= wideGap && rnd() < wideChance) {
      span = 2;
    }
    sinceBig = big ? 0 : sinceBig + 1;
    sinceWide = span > 1 ? 0 : sinceWide + 1;
    items.push({ key: f.id, ratio, span, kind: "frame", frame: f });

    sinceNote++;
    if (sinceNote >= noteGap && rnd() < noteChance) {
      sinceNote = 0;
      items.push({
        key: `note-${f.id}`,
        ratio: [0.8, 1, 1.25][Math.floor(rnd() * 3)],
        span: 1,
        kind: "note",
        roll: f.roll,
      });
    }
  }
  return items;
}

/** Без ритма: все кадры одной ширины, в порядке съёмки (страница плёнки) */
export function plainItems(frames: readonly Frame[]): FeedItem[] {
  return frames.map((f) => ({ key: f.id, ratio: f.w / f.h, span: 1, kind: "frame", frame: f }));
}
