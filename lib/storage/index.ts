import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Хранилище файлов кадров на диске сервера. Файлы лежат вне public/ и отдаются только через
// app/photos (с проверкой доступа). Чтобы перейти на облачное хранилище, достаточно переписать этот файл.
//
//   storage/feed/<id>.jpg        облегчённая копия для ленты
//   storage/full/<id>.jpg        крупная копия для просмотра на весь экран
//   storage/originals/<user>/<id>.<ext>   оригинал как загружен
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

/** Кладёт все три файла кадра. Если что-то не записалось, убирает уже записанное и кидает ошибку. */
export async function savePhoto(userId: number, id: string, files: PhotoFiles): Promise<void> {
  if (!SAFE_ID.test(id) || !SAFE_EXT.test(files.original.ext)) throw new Error("bad photo id");
  try {
    await writeAtomic(path.join(ROOT, "originals", String(userId), `${id}.${files.original.ext}`), files.original.data);
    await writeAtomic(renditionPath("full", id), files.full);
    await writeAtomic(renditionPath("feed", id), files.feed);
  } catch (e) {
    await deletePhoto(userId, id, files.original.ext);
    throw e;
  }
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
