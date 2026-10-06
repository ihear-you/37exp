"use client";

import { createStore } from "./persist";
import type { Format } from "./catalog";

// Правки папок и удалённые кадры прототипа. Хранятся в localStorage браузера и накладываются
// на данные из catalog.ts при показе страницы папки; в настоящем сайте это будет база.

export interface RollEdit {
  /** Своё название; без него название собирается из плёнки, даты и ISO */
  title?: string;
  description: string;
  filmId: string;
  cameraId: string;
  iso: number | null;
  format: Format;
  month: number;
  year: number;
}

export interface Edits {
  rolls: Record<string, RollEdit>;
  deletedFrames: string[];
}

export const EDITS_FALLBACK: Edits = { rolls: {}, deletedFrames: [] };

export const editsStore = createStore<Edits>("plenka:edits", "local", () => ({ rolls: {}, deletedFrames: [] }));
