import { randomBytes } from "node:crypto";
import { background, type UploadSlot } from "./db";
import { log } from "./log";
import { deletePhotos, deleteUploadParts, listUploadsWithParts } from "./storage";

// Загрузка идёт целиком или никак: и с устройства, и импорт с Яндекс Диска (у импорта номер загрузки совпадает
// с номером задания). Пока загрузка не закончена, её кадры помечены (frames.upload_id). Форма сообщает, что всё
// дошло (finishUpload), или что со страницы ушли (abandonUpload): тогда кадры этой загрузки стираются, плёнка,
// созданная ею, — тоже, а импорт останавливается. Если форма не успела сообщить (закрыли браузер, пропала сеть),
// загрузку разбирает уборщик: от неё долго ничего не приходило — значит, бросили.

/** Сколько ждать вестей от загрузки, прежде чем считать её брошенной. С устройства весть — каждый пришедший кадр
 *  (на медленном канале кадр идёт минутами), у импорта — опрос хода из формы раз в полторы секунды */
const STALE_MS = 30 * 60_000;
const IMPORT_STALE_MS = 3 * 60_000;
const SWEEP_EVERY_MS = 60_000;

/** Сколько незаконченных загрузок (с устройства и импортов) может быть у одного человека сразу */
export const MAX_OPEN_UPLOADS = 5;

/**
 * Сколько файлов одной загрузки может одновременно лежать недособранными (storage/parts). Загрузчик держит в пути
 * два кусочка, поэтому обычно файлов один-два; запас — на файлы, кусочки которых не дошли и ждут «Повторить».
 * Вместе с пределом на файл (MAX_FILE_MB) это ограничивает место, которое загрузка занимает до сборки
 */
export const MAX_OPEN_PARTS = 12;

export const ownsIdx = (u: UploadSlot, idx: number) => u.firstIdx === null || (idx >= u.firstIdx && idx < u.firstIdx + u.expected);

/**
 * id: для импорта — номер его задания; для загрузки с устройства создаётся новый.
 * firstIdx: первый из `expected` номеров, зарезервированных под загрузку: кадры с другими номерами она не принимает
 */
export function startUpload(
  userId: number,
  rollId: number,
  newRoll: boolean,
  expected: number,
  firstIdx: number,
  id = randomBytes(9).toString("hex"),
): string {
  ensureSweeper();
  background.insertUpload(id, userId, rollId, newRoll, expected, firstIdx);
  log("upload", `загрузка ${id}: старт, плёнка ${rollId}${newRoll ? " (новая)" : ""}, кадры №${firstIdx}–${firstIdx + expected - 1}`);
  return id;
}

/** Всё дошло: кадры остаются. false, если загрузки уже нет */
export async function finishUpload(userId: number, id: string): Promise<boolean> {
  const temp = background.completeUpload(userId, id);
  if (temp === null) return false;
  if (temp.length) await deletePhotos(userId, temp).catch(() => {});
  await deleteUploadParts(id).catch(() => {});
  log("upload", `загрузка ${id}: закончена${temp.length ? `, стёрто кадров без оригинала: ${temp.length}` : ""}`);
  return true;
}

/** Ушли со страницы до конца: кадры этой загрузки (и плёнка, если её создала она) стираются. false, если загрузки уже нет */
export async function abandonUpload(userId: number, id: string, why: string): Promise<boolean> {
  const result = background.abortUpload(userId, id);
  if (!result) return false;
  await deletePhotos(userId, result.frames).catch(() => {});
  await deleteUploadParts(id).catch(() => {});
  log("upload", `загрузка ${id}: отменена (${why}), стёрто кадров ${result.frames.length}${result.rollRemoved ? `, плёнка ${result.rollId} удалена` : ""}`);
  return true;
}

async function sweep() {
  const ago = (ms: number) => Math.floor((Date.now() - ms) / 1000);
  for (const u of background.findStaleUploads(ago(STALE_MS), ago(IMPORT_STALE_MS))) {
    // всё дошло, просто форма не успела сказать: считаем законченной
    if (u.done >= u.expected && u.temp === 0) await finishUpload(u.userId, u.id);
    else await abandonUpload(u.userId, u.id, `давно нет вестей, дошло ${u.done} из ${u.expected}`);
  }
  // недособранные файлы загрузок, которых уже нет (например, сервер перезапустили посреди отмены)
  const alive = new Set(background.listUploadIds());
  for (const id of await listUploadsWithParts()) if (!alive.has(id)) await deleteUploadParts(id).catch(() => {});
}

const g = globalThis as typeof globalThis & { __plenkaUploadSweeper?: ReturnType<typeof setInterval> };

/** Уборщик брошенных загрузок: запускается с первой загрузкой после старта сервера, сразу проверяет и дальше раз в минуту */
export function ensureSweeper() {
  if (g.__plenkaUploadSweeper) return;
  const run = () => void sweep().catch((e) => log("upload", `уборщик загрузок упал: ${e instanceof Error ? e.message : String(e)}`));
  g.__plenkaUploadSweeper = setInterval(run, SWEEP_EVERY_MS);
  g.__plenkaUploadSweeper.unref?.();
  run();
}
