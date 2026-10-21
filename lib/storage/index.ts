import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

// Хранилище файлов кадров на диске сервера. Файлы лежат вне public/ и отдаются только через
// app/photos (с проверкой доступа). Чтобы перейти на облачное хранилище, достаточно переписать этот файл.
//
//   storage/feed/<id>.jpg        облегчённая копия для ленты
//   storage/full/<id>.jpg        крупная копия для просмотра на весь экран
//   storage/originals/<user>/<id>.<ext>   оригинал как загружен
//   storage/parts/<upload>/<idx>.part     файл, который ещё приходит кусочками (lib/upload-queue.ts)
//
// Кадры из стартового набора (seed/photos) лежат в репозитории и читаются оттуда.

const ROOT = process.env.PLENKA_STORAGE_DIR ?? path.join(process.cwd(), "storage");
const SEED = path.join(process.cwd(), "seed", "photos");

export type Rendition = "feed" | "full";

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const SAFE_EXT = /^[a-z0-9]{1,5}$/;

const renditionPath = (kind: Rendition, id: string) => path.join(ROOT, kind, `${id}.jpg`);
const seedPath = (kind: Rendition, id: string) => path.join(SEED, kind === "feed" ? "f" : "l", `${id}.jpg`);

async function writeAtomic(file: string, data: Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export interface PhotoFiles {
  original: { data: Buffer; ext: string };
  feed: Buffer;
  full: Buffer;
}

/**
 * Кладёт все три файла кадра. Если что-то не записалось, убирает уже записанное и кидает ошибку.
 * keepOnFailure: при замене временных копий на настоящие (импорт, шаг 2) прежние файлы кадра
 * стирать нельзя, иначе уже показанный кадр останется без картинки.
 */
export async function savePhoto(userId: number, id: string, files: PhotoFiles, options: { keepOnFailure?: boolean } = {}): Promise<void> {
  if (!SAFE_ID.test(id) || !SAFE_EXT.test(files.original.ext)) throw new Error("bad photo id");
  try {
    await writeAtomic(path.join(ROOT, "originals", String(userId), `${id}.${files.original.ext}`), files.original.data);
    await writeAtomic(renditionPath("full", id), files.full);
    await writeAtomic(renditionPath("feed", id), files.feed);
  } catch (e) {
    if (!options.keepOnFailure) await deletePhoto(userId, id, files.original.ext);
    throw e;
  }
}

// ── файлы, которые приходят кусочками ──
// Браузер шлёт файл частями по 1 МБ, по две сразу, поэтому они могут прийти не по порядку: каждая пишется
// на своё место. Повтор той же части безопасен. Когда браузер говорит «файл весь», он читается целиком.

const partPath = (uploadId: string, idx: number) => path.join(ROOT, "parts", uploadId, `${idx}.part`);
const safePart = (uploadId: string, idx: number) => SAFE_ID.test(uploadId) && Number.isInteger(idx) && idx > 0;

export async function writeUploadPart(uploadId: string, idx: number, offset: number, data: Uint8Array): Promise<void> {
  if (!safePart(uploadId, idx)) throw new Error("bad part");
  const file = partPath(uploadId, idx);
  await mkdir(path.dirname(file), { recursive: true });
  // создать, если файла ещё нет, не обрезая уже записанное соседней частью; писать — в режиме r+ (в режиме
  // дозаписи запись по смещению не работает)
  await (await open(file, "a")).close();
  const fd = await open(file, "r+");
  try {
    await fd.write(data, 0, data.length, offset);
  } finally {
    await fd.close();
  }
}

/** Собранный файл или null, если его нет или размер не тот (пришли не все части) */
export async function readUploadPart(uploadId: string, idx: number, size: number): Promise<Buffer | null> {
  if (!safePart(uploadId, idx)) return null;
  const file = partPath(uploadId, idx);
  const info = await stat(file).catch(() => null);
  if (!info || info.size !== size) return null;
  return readFile(file);
}

export async function deleteUploadPart(uploadId: string, idx: number): Promise<void> {
  if (safePart(uploadId, idx)) await rm(partPath(uploadId, idx), { force: true });
}

/** Стирает все недособранные файлы загрузки (она закончена или отменена) */
export async function deleteUploadParts(uploadId: string): Promise<void> {
  if (SAFE_ID.test(uploadId)) await rm(path.join(ROOT, "parts", uploadId), { recursive: true, force: true });
}

/** Загрузки, у которых на диске лежат недособранные файлы (для уборки) */
export async function listUploadsWithParts(): Promise<string[]> {
  return readdir(path.join(ROOT, "parts")).catch(() => [] as string[]);
}

/** Копии кадра без оригинала: временный кадр по уменьшенной копии от источника (оригинал придёт позже) */
export async function saveRenditions(id: string, files: { feed: Buffer; full: Buffer }): Promise<void> {
  if (!SAFE_ID.test(id)) throw new Error("bad photo id");
  await writeAtomic(renditionPath("full", id), files.full);
  await writeAtomic(renditionPath("feed", id), files.feed);
}

export async function deleteRenditions(id: string): Promise<void> {
  if (!SAFE_ID.test(id)) return;
  await Promise.all([rm(renditionPath("full", id), { force: true }), rm(renditionPath("feed", id), { force: true })]);
}

/** Стирает все файлы кадров (удаление плёнки): копии и оригиналы с любым расширением. Кадры стартового набора не трогает */
export async function deletePhotos(userId: number, ids: readonly string[]): Promise<void> {
  const wanted = new Set(ids.filter((id) => SAFE_ID.test(id)));
  if (wanted.size === 0) return;
  const originals = path.join(ROOT, "originals", String(userId));
  const names = await readdir(originals).catch(() => [] as string[]);
  await Promise.all([
    ...names.filter((n) => wanted.has(n.split(".")[0])).map((n) => rm(path.join(originals, n), { force: true })),
    ...[...wanted].flatMap((id) => [rm(renditionPath("full", id), { force: true }), rm(renditionPath("feed", id), { force: true })]),
  ]);
}

/** Уборка файлов кадра (ошибка записи в базу после записи файлов) */
export async function deletePhoto(userId: number, id: string, ext: string): Promise<void> {
  if (!SAFE_ID.test(id) || !SAFE_EXT.test(ext)) return;
  await Promise.all([
    rm(path.join(ROOT, "originals", String(userId), `${id}.${ext}`), { force: true }),
    rm(renditionPath("full", id), { force: true }),
    rm(renditionPath("feed", id), { force: true }),
  ]);
}

/** Оригинал кадра целиком (поворот) с расширением. null, если файла нет */
export async function readOriginal(userId: number, id: string): Promise<{ data: Buffer; ext: string } | null> {
  if (!SAFE_ID.test(id)) return null;
  const dir = path.join(ROOT, "originals", String(userId));
  const name = (await readdir(dir).catch(() => [] as string[])).find((n) => n.split(".")[0] === id);
  const ext = name?.split(".")[1];
  if (!name || !ext || !SAFE_EXT.test(ext)) return null;
  return { data: await readFile(path.join(dir, name)), ext };
}

/** Оригинал кадра для скачивания: поток (не читаем в память, оригиналы бывают до 40 МБ), размер и расширение. null, если файла нет */
export async function openOriginal(userId: number, id: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number; ext: string } | null> {
  if (!SAFE_ID.test(id)) return null;
  const dir = path.join(ROOT, "originals", String(userId));
  const name = (await readdir(dir).catch(() => [] as string[])).find((n) => n.split(".")[0] === id);
  const ext = name?.split(".")[1];
  if (!name || !ext || !SAFE_EXT.test(ext)) return null;
  const file = path.join(dir, name);
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  return { stream: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, size: info.size, ext };
}

/** Копия кадра для показа или null, если файла нет */
export async function readPhoto(kind: Rendition, id: string): Promise<Buffer | null> {
  if (!SAFE_ID.test(id)) return null;
  for (const file of [renditionPath(kind, id), seedPath(kind, id)]) {
    try {
      return await readFile(file);
    } catch {
      // нет здесь, смотрим дальше
    }
  }
  return null;
}
