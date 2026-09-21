// Режимы ленты: как отбираются и упорядочиваются кадры.
// Цвет и яркость используются только здесь (в папках их нет).

import type { Frame } from "./catalog";
import { mulberry32, shuffled } from "./rand";

export type Mode = "shuffle" | "color" | "warm" | "cold" | "light" | "dark" | "bw";

export const MODES: { id: Mode; label: string }[] = [
  { id: "shuffle", label: "Вперемешку" },
  { id: "color", label: "По цвету" },
  { id: "warm", label: "Тёплые" },
  { id: "cold", label: "Холодные" },
  { id: "light", label: "Светлые" },
  { id: "dark", label: "Тёмные" },
  { id: "bw", label: "Ч/б" },
];

const isBw = (f: Frame) => f.sat < 0.07;
const isColor = (f: Frame) => f.sat >= 0.12;

const MATCH: Record<Exclude<Mode, "shuffle" | "color">, (f: Frame) => boolean> = {
  warm: (f) => isColor(f) && (f.hue <= 75 || f.hue >= 330),
  cold: (f) => isColor(f) && f.hue >= 90 && f.hue <= 290, // зелёный, голубой, синий, фиолетовый
  light: (f) => f.light > 0.62,
  dark: (f) => f.light < 0.32,
  bw: isBw,
};

/** Отобрать кадры режима и расставить: случайно по seed, а «по цвету» по кругу оттенков */
export function orderFrames(frames: readonly Frame[], mode: Mode, seed: number): Frame[] {
  if (mode === "shuffle") return shuffled(frames, seed);
  if (mode === "color") {
    const chromatic = frames.filter((f) => !isBw(f)).sort((a, b) => a.hue - b.hue);
    const grey = frames.filter(isBw).sort((a, b) => a.light - b.light);
    return [...chromatic, ...grey];
  }
  return shuffled(frames.filter(MATCH[mode]), seed);
}

// ── ритм ленты: какие кадры занимают две колонки и где пустые клетки ──

export interface FeedItem {
  key: string;
  ratio: number;
  span: 1 | 2;
  kind: "frame" | "note";
  frame?: Frame;
  /** У пустой клетки: чья это плёнка */
  roll?: number;
}

/**
 * Решаем, какие кадры растянуть на две колонки (случайно, но не подряд, только горизонтальные)
 * и куда вставить пустые клетки с подписью плёнки. Тот же seed даёт ту же раскладку.
 */
export function planFeed(frames: readonly Frame[], cols: number, seed: number): FeedItem[] {
  const rnd = mulberry32(seed ^ 0x9e3779b1 ^ (cols * 7919));
  const wide = cols >= 4;
  const spanChance = wide ? 0.3 : 0.18; // часть станет узкими, если не найдётся ровной пары колонок
  const spanGap = wide ? 3 : 6; // сколько кадров минимум между двумя широкими
  const noteChance = 0.05;
  const noteGap = 14; // пустые клетки редкие: не чаще одной на 14 кадров

  const items: FeedItem[] = [];
  let sinceSpan = spanGap;
  let sinceNote = 0;

  for (const f of frames) {
    const ratio = f.w / f.h;
    const canSpan = ratio >= 1.2 && sinceSpan >= spanGap;
    const span = canSpan && rnd() < spanChance ? 2 : 1;
    sinceSpan = span === 2 ? 0 : sinceSpan + 1;
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
