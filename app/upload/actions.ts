"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { ISO_VALUES, type Camera, type Film, type Format } from "@/lib/catalog";
import { createCamera, createFilm, createRoll, getMyFilms, getUsedBytes, reserveFrameSlots } from "@/lib/db";
import { MAX_FRAMES_PER_UPLOAD, USER_QUOTA_BYTES } from "@/lib/photos/limits";

// Серверные действия страницы загрузки. Сами кадры принимает app/api/rolls/[id]/frames.

const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Своя плёнка (марка), которой нет в справочнике. null, если не вошли или название пустое */
export async function createFilmAction(name: string, iso: number | null): Promise<Film | null> {
  const user = await requireUser();
  const clean = typeof name === "string" ? name.trim().slice(0, 80) : "";
  if (!user || !clean || (iso !== null && !ISO_VALUES.includes(iso))) return null;
  return createFilm(user.id, clean, iso);
}

/** Своя камера. null, если не вошли или название пустое */
export async function createCameraAction(name: string): Promise<Camera | null> {
  const user = await requireUser();
  const clean = typeof name === "string" ? name.trim().slice(0, 80) : "";
  if (!user || !clean) return null;
  return createCamera(user.id, clean);
}

export interface StartUploadInput {
  /** Куда добавить кадры: номер существующей плёнки; иначе создаётся новая из roll */
  rollId: number | null;
  roll: { filmId: string; format: Format; iso: number | null; cameraId: string; month: number; year: number; description: string } | null;
  count: number;
  totalBytes: number;
}

export type StartUploadResult = { ok: true; rollId: number; firstIdx: number } | { ok: false; error: string };

/**
 * Начало загрузки: создаёт новую плёнку (она всегда «только я») или берёт существующую и резервирует номера
 * для `count` кадров. Дальше клиент отправляет кадры по одному в /api/rolls/<номер>/frames.
 */
export async function startUploadAction(input: StartUploadInput): Promise<StartUploadResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Войдите, чтобы загружать" };
  if (!isInt(input.count, 1, MAX_FRAMES_PER_UPLOAD)) return { ok: false, error: `За один раз можно загрузить от 1 до ${MAX_FRAMES_PER_UPLOAD} кадров` };
  if ((await getUsedBytes(user.id)) + (Number(input.totalBytes) || 0) > USER_QUOTA_BYTES) {
    return { ok: false, error: "Не хватит места в вашем архиве (лимит на пользователя)" };
  }

  let rollId = input.rollId;
  if (rollId === null) {
    const r = input.roll;
    const films = await getMyFilms(user.id);
    if (
      !r ||
      !films.some((f) => f.id === r.filmId) ||
      (r.format !== "35" && r.format !== "120") ||
      !isInt(r.month, 1, 12) ||
      !isInt(r.year, 1900, 2200) ||
      (r.iso !== null && !isInt(r.iso, 1, 100000)) ||
      typeof r.description !== "string"
    ) {
      return { ok: false, error: "Проверьте поля плёнки" };
    }
    rollId = await createRoll(user.id, { ...r, title: null, description: r.description.trim().slice(0, 5000) });
    if (rollId === null) return { ok: false, error: "Не удалось создать плёнку: проверьте камеру и плёнку" };
  }

  const firstIdx = await reserveFrameSlots(user.id, rollId, input.count);
  if (firstIdx === null) return { ok: false, error: "Такой плёнки нет" };

  revalidatePath("/", "layout");
  return { ok: true, rollId, firstIdx };
}
