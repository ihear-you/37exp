"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { ISO_VALUES, validPeriod, type Camera, type Film, type Format } from "@/lib/catalog";
import {
  createCamera,
  createFilm,
  createImport,
  countMyOpenUploads,
  createRoll,
  getMyFilms,
  getUsedBytes,
  reserveFrameSlots,
  retryImport,
} from "@/lib/db";
import { runImport } from "@/lib/import/runner";
import { ImportError, listYandex, normalizeYandexUrl } from "@/lib/import/yandex";
import { MAX_FRAMES_PER_UPLOAD, USER_QUOTA_BYTES } from "@/lib/photos/limits";
import { MAX_OPEN_UPLOADS, startUpload } from "@/lib/uploads";

// Серверные действия страницы загрузки. Кадры с устройства принимает app/api/uploads/[id]/parts и /frames,
// импорт по ссылке (Яндекс Диск) идёт в фоне на сервере: lib/import, состояние отдаёт app/api/imports/[id].

const TOO_MANY_UPLOADS = `Сейчас идёт ${MAX_OPEN_UPLOADS} загрузок: дождитесь, пока одна закончится`;

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

/** Новая плёнка: при старте загрузки — по подсказкам, поправить можно в карточке «Что это за плёнка?». cameraId "" — не указана */
type NewRollInput = {
  filmId: string;
  format: Format;
  iso: number | null;
  cameraId: string;
  month: number;
  year: number;
  endMonth: number | null;
  endYear: number | null;
  description: string;
  /** Своё название папки (по названию папки-источника); null — соберётся из плёнки и даты */
  title?: string | null;
};

/** Куда класть кадры: существующая плёнка или новая (она всегда создаётся «только я») */
async function resolveRoll(
  userId: number,
  rollId: number | null,
  r: NewRollInput | null,
): Promise<{ ok: true; rollId: number } | { ok: false; error: string }> {
  if (rollId !== null) return Number.isInteger(rollId) ? { ok: true, rollId } : { ok: false, error: "Такой плёнки нет" };
  const films = await getMyFilms(userId);
  if (
    !r ||
    !films.some((f) => f.id === r.filmId) ||
    (r.format !== "35" && r.format !== "120") ||
    !validPeriod(r) ||
    typeof r.cameraId !== "string" ||
    (r.iso !== null && !isInt(r.iso, 1, 100000)) ||
    typeof r.description !== "string" ||
    (r.title != null && typeof r.title !== "string")
  ) {
    return { ok: false, error: "Проверьте поля плёнки" };
  }
  const created = await createRoll(userId, { ...r, title: r.title?.trim().slice(0, 200) || null, description: r.description.trim().slice(0, 5000) });
  return created === null ? { ok: false, error: "Не удалось создать плёнку: проверьте камеру и плёнку" } : { ok: true, rollId: created };
}

export interface StartUploadInput {
  /** Куда добавить кадры: номер существующей плёнки; иначе создаётся новая из roll */
  rollId: number | null;
  roll: NewRollInput | null;
  count: number;
  totalBytes: number;
}

/** uploadId: загрузка идёт целиком или никак (lib/uploads.ts); его нужно слать с каждым кадром */
export type StartUploadResult = { ok: true; rollId: number; firstIdx: number; uploadId: string } | { ok: false; error: string };

/**
 * Начало загрузки: создаёт новую плёнку (она всегда «только я») или берёт существующую и резервирует номера
 * для `count` кадров. Дальше загрузчик (lib/upload-queue.ts) шлёт файлы кусочками в /api/uploads/<uploadId>/parts.
 */
export async function startUploadAction(input: StartUploadInput): Promise<StartUploadResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Войдите, чтобы загружать" };
  if (!isInt(input.count, 1, MAX_FRAMES_PER_UPLOAD)) return { ok: false, error: `За один раз можно загрузить от 1 до ${MAX_FRAMES_PER_UPLOAD} кадров` };
  if ((await countMyOpenUploads(user.id)) >= MAX_OPEN_UPLOADS) return { ok: false, error: TOO_MANY_UPLOADS };
  if ((await getUsedBytes(user.id)) + (Number(input.totalBytes) || 0) > USER_QUOTA_BYTES) {
    return { ok: false, error: "Не хватит места в вашем архиве (лимит на пользователя)" };
  }

  const target = await resolveRoll(user.id, input.rollId, input.roll);
  if (!target.ok) return target;
  const rollId = target.rollId;

  const firstIdx = await reserveFrameSlots(user.id, rollId, input.count);
  if (firstIdx === null) return { ok: false, error: "Такой плёнки нет" };
  const uploadId = startUpload(user.id, rollId, input.rollId === null, input.count, firstIdx);

  revalidatePath("/", "layout");
  return { ok: true, rollId, firstIdx, uploadId };
}

// ── импорт по ссылке ──

const IMPORT_ERRORS: Record<string, string> = {
  link: "Это не ссылка на Яндекс Диск. Нужна публичная ссылка вида https://disk.yandex.ru/d/…",
  notfound: "По этой ссылке ничего нет: проверьте, что доступ по ссылке включён",
  empty: "По ссылке нет картинок",
  toomany: `Слишком много файлов: за один раз можно взять до ${MAX_FRAMES_PER_UPLOAD} кадров`,
  source: "Яндекс Диск не ответил, попробуйте ещё раз",
};
const importError = (e: unknown) => IMPORT_ERRORS[e instanceof ImportError ? e.code : "source"] ?? IMPORT_ERRORS.source;

export type PreviewImportResult =
  | {
      ok: true;
      /** Название папки (или файла) на Диске: по нему форма подсказывает плёнку и дату */
      name: string;
      /** preview: миниатюра с Диска для плитки (может не быть) */
      files: { name: string; size: number; preview: string | null }[];
      totalBytes: number;
      /** Пропущено: не картинки и вложенные папки */
      skipped: number;
      /** Пропущено: картинки больше предела на файл */
      tooBig: number;
    }
  | { ok: false; error: string };

/** Что лежит по публичной ссылке Яндекс Диска. Ничего не скачивает и не создаёт. */
export async function previewImportAction(url: string): Promise<PreviewImportResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Войдите, чтобы загружать" };
  const key = typeof url === "string" ? normalizeYandexUrl(url) : null;
  if (!key) return { ok: false, error: IMPORT_ERRORS.link };
  try {
    const listing = await listYandex(key);
    return {
      ok: true,
      name: listing.name,
      files: listing.files.map((f) => ({ name: f.name, size: f.size, preview: f.preview })),
      totalBytes: listing.files.reduce((sum, f) => sum + f.size, 0),
      skipped: listing.skipped,
      tooBig: listing.tooBig,
    };
  } catch (e) {
    return { ok: false, error: importError(e) };
  }
}

export interface StartImportInput {
  url: string;
  /** Куда добавить кадры: номер существующей плёнки; иначе создаётся новая из roll */
  rollId: number | null;
  roll: NewRollInput | null;
}

export type StartImportResult = { ok: true; importId: string; rollId: number; count: number } | { ok: false; error: string };

/**
 * Запускает импорт: сервер сам скачивает кадры по ссылке. Сначала кадры появляются в плёнке по уменьшенным
 * копиям (секунды), потом в фоне приходят оригиналы и заменяют их.
 * Список файлов берётся заново на сервере (не от клиента). За ходом следить по /api/imports/<importId>.
 */
export async function startImportAction(input: StartImportInput): Promise<StartImportResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Войдите, чтобы загружать" };
  const key = typeof input.url === "string" ? normalizeYandexUrl(input.url) : null;
  if (!key) return { ok: false, error: IMPORT_ERRORS.link };
  if ((await countMyOpenUploads(user.id)) >= MAX_OPEN_UPLOADS) return { ok: false, error: TOO_MANY_UPLOADS };

  let files;
  try {
    // крупные копии: по ним кадры появятся в плёнке сразу, оригиналы докачаются следом
    files = (await listYandex(key, "large")).files;
  } catch (e) {
    return { ok: false, error: importError(e) };
  }
  if ((await getUsedBytes(user.id)) + files.reduce((sum, f) => sum + f.size, 0) > USER_QUOTA_BYTES) {
    return { ok: false, error: "Не хватит места в вашем архиве (лимит на пользователя)" };
  }

  // плёнку создаём только когда ссылка проверена, чтобы не оставлять пустых папок
  const target = await resolveRoll(user.id, input.rollId, input.roll);
  if (!target.ok) return target;
  const firstIdx = await reserveFrameSlots(user.id, target.rollId, files.length);
  if (firstIdx === null) return { ok: false, error: "Такой плёнки нет" };

  const importId = await createImport(
    user.id,
    target.rollId,
    "yandex",
    key,
    files.map((f, n) => ({ name: f.name, path: f.path, size: f.size, idx: firstIdx + n, preview: f.preview })),
  );
  // целиком или никак, как загрузка с устройства: ушли со страницы до конца — импорт останавливается, его кадры стираются
  startUpload(user.id, target.rollId, input.rollId === null, files.length, firstIdx, importId);
  runImport(importId);

  revalidatePath("/", "layout");
  return { ok: true, importId, rollId: target.rollId, count: files.length };
}

/** Повторяет сбойные файлы импорта. true, если было что повторять */
export async function retryImportAction(importId: string): Promise<boolean> {
  const user = await requireUser();
  if (!user || typeof importId !== "string") return false;
  const requeued = await retryImport(user.id, importId);
  if (requeued > 0) runImport(importId);
  return requeued > 0;
}
