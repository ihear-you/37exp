import { randomBytes } from "node:crypto";
import { background } from "../db";
import { deletePhoto, deleteRenditions, savePhoto, saveRenditions } from "../storage";
import { MAX_FILE_BYTES, USER_QUOTA_BYTES } from "./limits";
import { describePhoto, processPhoto } from "./process";

// Приём кадра в плёнку: проверка лимитов, обработка, запись файлов и строки в базе.
// Общий путь для загрузки с компьютера (app/api/rolls/[id]/frames) и импорта по ссылке (lib/import).
// Работает и вне запроса (фоновый импорт), поэтому берёт запросы к базе без connection().
//
// Импорт по ссылке идёт в два шага, чтобы плёнка появлялась за секунды:
//   1) ingestPreview: кадр создаётся по уменьшенной копии от источника и сразу виден (временный);
//   2) finalizePhoto: приходит оригинал, копии и данные кадра заменяются настоящими.
// Загрузка с компьютера и файлы без уменьшенной копии идут одним шагом: ingestPhoto.

const EXT: Record<string, string> = { jpeg: "jpg", png: "png", tiff: "tif", webp: "webp", heif: "heic", gif: "gif", avif: "avif" };

type IngestError = "size" | "quota" | "format" | "storage" | "roll";

export type IngestResult =
  | { status: "ok"; id: string; w: number; h: number }
  /** кадр с этим номером в плёнке уже есть (повторная отправка): считается успехом */
  | { status: "exists" }
  | { status: "error"; error: IngestError };

const newId = () => randomBytes(6).toString("hex");

export async function ingestPhoto(userId: number, rollId: number, idx: number, original: Buffer): Promise<IngestResult> {
  if (original.length > MAX_FILE_BYTES) return { status: "error", error: "size" };
  if (background.usedBytes(userId) + original.length > USER_QUOTA_BYTES) return { status: "error", error: "quota" };

  let photo;
  try {
    photo = await processPhoto(original);
  } catch {
    return { status: "error", error: "format" };
  }

  const id = newId();
  const ext = EXT[photo.format] ?? "img";
  try {
    await savePhoto(userId, id, { original: { data: original, ext }, feed: photo.feed, full: photo.full });
  } catch {
    return { status: "error", error: "storage" };
  }

  const { w, h, hue, sat, light, color } = photo;
  const result = background.addFrame(userId, rollId, { id, idx, w, h, hue, sat, light, color, bytes: original.length });
  if (result !== "ok") {
    await deletePhoto(userId, id, ext);
    return result === "exists" ? { status: "exists" } : { status: "error", error: "roll" };
  }
  return { status: "ok", id, w, h };
}

/**
 * Шаг 1 импорта: временный кадр по уменьшенной копии. Копия кладётся как есть (и для ленты, и для
 * просмотра), без пересжатия, поэтому это быстро. Места в лимите временный кадр не занимает.
 */
export async function ingestPreview(userId: number, rollId: number, idx: number, preview: Buffer): Promise<IngestResult> {
  let info;
  try {
    info = await describePhoto(preview);
  } catch {
    return { status: "error", error: "format" };
  }

  const id = newId();
  try {
    await saveRenditions(id, { feed: preview, full: preview });
  } catch {
    return { status: "error", error: "storage" };
  }

  const { w, h, hue, sat, light, color } = info;
  const result = background.addFrame(userId, rollId, { id, idx, w, h, hue, sat, light, color, bytes: 0, provisional: true });
  if (result !== "ok") {
    await deleteRenditions(id);
    return result === "exists" ? { status: "exists" } : { status: "error", error: "roll" };
  }
  return { status: "ok", id, w, h };
}

/** Стирает временный кадр вместе с копиями: его оригинал принять нельзя. true, если кадр был и стёрт */
export async function discardProvisional(userId: number, frameId: string): Promise<boolean> {
  const removed = background.removeProvisionalFrame(userId, frameId);
  if (removed) await deleteRenditions(frameId);
  return removed;
}

/**
 * Шаг 2 импорта: оригинал для временного кадра. Копии заменяются сделанными с оригинала, кадр получает
 * настоящие размеры и цвет и начинает занимать место в лимите.
 * Если оригинал принять нельзя совсем (лимит, размер, не читается), временный кадр стирается:
 * кадров без оригинала в архиве не остаётся. При сбое записи кадр остаётся, шаг можно повторить.
 */
export async function finalizePhoto(
  userId: number,
  frameId: string,
  original: Buffer,
): Promise<{ status: "ok" } | { status: "error"; error: IngestError; removed: boolean }> {
  const drop = async (error: IngestError) => ({ status: "error" as const, error, removed: await discardProvisional(userId, frameId) });

  if (original.length > MAX_FILE_BYTES) return drop("size");
  if (background.usedBytes(userId) + original.length > USER_QUOTA_BYTES) return drop("quota");

  let photo;
  try {
    photo = await processPhoto(original);
  } catch {
    return drop("format");
  }

  try {
    await savePhoto(userId, frameId, { original: { data: original, ext: EXT[photo.format] ?? "img" }, feed: photo.feed, full: photo.full }, { keepOnFailure: true });
  } catch {
    return { status: "error", error: "storage", removed: false };
  }

  const { w, h, hue, sat, light, color } = photo;
  if (!background.finalizeFrame(userId, frameId, { w, h, hue, sat, light, color, bytes: original.length })) {
    return { status: "error", error: "roll", removed: false };
  }
  return { status: "ok" };
}
