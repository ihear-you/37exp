import { connection } from "next/server";
import { canView } from "../access";
import { FILMS, rollView, type Camera, type Film, type Frame, type Roll, type RollEdit, type RollView, type Visibility } from "../catalog";
import { deletePhotos } from "../storage";
import * as q from "./queries";
import { DEFAULT_USER_ID } from "./user";

// Единственная точка доступа к данным для страниц и серверных действий.
// Функции асинхронные и отдают простые объекты, чтобы SQLite можно было заменить на размещённую
// базу, переписав только queries.ts и connection.ts.
// «Мои» функции берут userId вошедшего пользователя и отдают всё его (любой доступ). Чужое читается только
// через getRollForViewer и getPublicProfile, они сами проверяют права (lib/access.ts).
// connection(): ответ зависит от базы, а не от кода, поэтому в сборку страницы не запекаются.

// ── моё: плёнки, кадры, камеры вошедшего пользователя ──

export async function getMyCameras(userId: number): Promise<Camera[]> {
  await connection();
  return q.listCameras(userId);
}

/** Все мои плёнки для списков: готовые названия, камера и число кадров */
export async function getMyRollViews(userId: number): Promise<RollView[]> {
  await connection();
  const cameras = q.listCameras(userId);
  const films = [...FILMS, ...q.listUserFilms(userId)];
  return q.listRolls(userId).map(({ roll, count }) => rollView(roll, cameras, count, films));
}

/** Справочник плёнок плюс те, что пользователь добавил сам */
export async function getMyFilms(userId: number): Promise<Film[]> {
  await connection();
  return [...FILMS, ...q.listUserFilms(userId)];
}

/** Все мои кадры для ленты, без удалённых */
export async function getMyFeedFrames(userId: number): Promise<Frame[]> {
  await connection();
  return q.listAllFrames(userId);
}

/** Первые кадры каждой моей плёнки: { номер плёнки: кадры } */
export async function getMyRollPreviews(userId: number, perRoll: number): Promise<Record<number, Frame[]>> {
  await connection();
  return groupByRoll(q.listFramePreviews(userId, perRoll));
}

export async function getMyCounts(userId: number): Promise<{ rolls: number; frames: number }> {
  await connection();
  return q.countAll(userId);
}

const groupByRoll = (frames: Frame[]) => {
  const out: Record<number, Frame[]> = {};
  for (const f of frames) (out[f.roll] ??= []).push(f);
  return out;
};

// ── чужое: только то, что viewer имеет право видеть ──

export interface RollPage {
  roll: Roll;
  frames: Frame[];
  cameras: Camera[];
  films: Film[];
  /** Автор плёнки: адрес его страницы и признак «это я» */
  ownerHandle: string;
  isOwner: boolean;
  /** Соседние плёнки автора, которые viewer видит, вместе с самой плёнкой */
  siblings: RollView[];
}

/**
 * Плёнка для страницы. null, если её нет или viewer не имеет права её видеть (ответ одинаковый,
 * чтобы закрытые плёнки нельзя было нащупать перебором номеров). keys: ключи ссылок, которые есть у зрителя.
 * Ключ для ссылки отдаётся только автору.
 */
export async function getRollForViewer(id: number, viewerId: number | null, keys: readonly string[]): Promise<RollPage | null> {
  await connection();
  const found = q.findRoll(id);
  if (!found) return null;
  const { roll, ownerId, count } = found;
  if (!canView({ ownerId, visibility: roll.visibility ?? "private", shareKey: roll.shareKey ?? null }, viewerId, keys)) return null;

  const isOwner = viewerId === ownerId;
  const owner = q.findUserById(ownerId);
  const cameras = q.listCameras(ownerId);
  const films = [...FILMS, ...q.listUserFilms(ownerId)];
  const views = q.listRolls(ownerId, !isOwner).map(({ roll: r, count: n }) => rollView(r, cameras, n, films));
  if (!views.some((v) => v.id === roll.id)) views.push(rollView(roll, cameras, count, films)); // плёнка «по ссылке»

  return {
    roll: isOwner ? roll : { ...roll, shareKey: undefined },
    frames: q.listFramesOfRoll(ownerId, roll.id),
    cameras,
    films,
    ownerHandle: owner?.handle ?? "",
    isOwner,
    siblings: views,
  };
}

export interface PublicProfile {
  user: { handle: string; name: string; avatarUrl: string | null };
  rolls: RollView[];
  previews: Record<number, Frame[]>;
}

/** Страница автора: только плёнки, открытые всем. null, если такого адреса нет */
export async function getPublicProfile(handle: string, previewCount: number): Promise<PublicProfile | null> {
  await connection();
  const user = q.findUserByHandle(handle);
  if (!user) return null;
  const cameras = q.listCameras(user.id);
  const films = [...FILMS, ...q.listUserFilms(user.id)];
  return {
    user: { handle: user.handle, name: user.name, avatarUrl: user.avatarUrl },
    rolls: q.listRolls(user.id, true).map(({ roll, count }) => rollView(roll, cameras, count, films)),
    previews: groupByRoll(q.listFramePreviews(user.id, previewCount, true)),
  };
}

/**
 * Создаёт плёнку (папку) пользователя. Новая плёнка всегда «только я»: автор потом сам меняет это в «Изменить».
 * Номер новой плёнки или null, если камеры нет среди камер пользователя.
 */
export async function createRoll(userId: number, roll: q.NewRoll): Promise<number | null> {
  await connection();
  if (roll.cameraId && !q.listCameras(userId).some((c) => c.id === roll.cameraId)) return null;
  if (!(await getMyFilms(userId)).some((f) => f.id === roll.filmId)) return null;
  return q.insertRoll(userId, roll);
}

/** false, если такой плёнки нет */
export async function updateRoll(userId: number, id: number, edit: RollEdit): Promise<boolean> {
  await connection();
  if (edit.cameraId && !q.listCameras(userId).some((c) => c.id === edit.cameraId)) return false;
  if (!(await getMyFilms(userId)).some((f) => f.id === edit.filmId)) return false;
  return q.saveRoll(userId, id, edit);
}

/** Кто видит плёнку. false, если такой плёнки нет */
export async function setRollVisibility(userId: number, id: number, visibility: Visibility): Promise<boolean> {
  await connection();
  return q.setRollVisibility(userId, id, visibility);
}

/**
 * Удаляет плёнку целиком: её кадры, задания импорта и файлы (оригиналы и копии), место в лимите освобождается.
 * Это необратимо. false, если такой плёнки нет.
 */
export async function deleteRoll(userId: number, id: number): Promise<boolean> {
  await connection();
  const frames = q.deleteRoll(userId, id);
  if (frames === null) return false;
  // строки уже удалены: если файл не сотрётся, он просто останется лежать, на сайте его не будет
  await deletePhotos(userId, frames).catch(() => {});
  return true;
}

/** false, если такого кадра нет */
export async function deleteFrame(userId: number, frameId: string): Promise<boolean> {
  await connection();
  return q.markFrameDeleted(userId, frameId);
}

export async function createFilm(userId: number, name: string, iso: number | null): Promise<Film> {
  await connection();
  return q.insertUserFilm(userId, name, iso);
}

export async function createCamera(userId: number, name: string): Promise<Camera> {
  await connection();
  return q.insertCamera(userId, name);
}

// ── загрузка кадров ──

export type { NewFrame, NewRoll, FrameAccess } from "./queries";

/** Резервирует номера для `count` кадров плёнки и возвращает первый; null, если плёнки нет или она чужая */
export async function reserveFrameSlots(userId: number, rollId: number, count: number): Promise<number | null> {
  await connection();
  return q.reserveFrameSlots(userId, rollId, count);
}

export async function addFrame(userId: number, rollId: number, frame: q.NewFrame) {
  await connection();
  return q.insertFrame(userId, rollId, frame);
}

export async function getUsedBytes(userId: number): Promise<number> {
  await connection();
  return q.userStorageBytes(userId);
}

// ── доступ к файлам и ссылкам ──

export async function getFrameOriginal(frameId: string) {
  await connection();
  return q.findFrameOriginal(frameId);
}

export async function getFrameAccess(frameId: string) {
  await connection();
  return q.findFrameAccess(frameId);
}

export async function getRollByShareKey(key: string) {
  await connection();
  return q.findRollIdByShareKey(key);
}

// ── импорт по ссылке ──

export type { ImportItem, ImportItemStatus, ImportJob } from "./queries";

export async function createImport(
  userId: number,
  rollId: number,
  source: string,
  sourceUrl: string,
  items: { name: string; path: string; size: number; idx: number; preview: string | null }[],
): Promise<string> {
  await connection();
  return q.insertImport(userId, rollId, source, sourceUrl, items);
}

/** Задание пользователя с файлами; null, если его нет или оно чужое */
export async function getImport(userId: number, id: string): Promise<q.ImportJob | null> {
  await connection();
  return q.findImport(id, userId);
}

/** Возвращает сбойные файлы в очередь; сколько вернулось (0, если задания нет или оно чужое) */
export async function retryImport(userId: number, id: string): Promise<number> {
  await connection();
  return q.findImport(id, userId) ? q.requeueImportItems(id, ["error"]) : 0;
}

/**
 * Для фоновых задач (импорт по ссылке). Они продолжают работать после ответа сервера, вне запроса,
 * поэтому здесь нет connection(): только запросы к базе. Права проверяет тот, кто запускает задачу.
 */
export const background = {
  usedBytes: q.userStorageBytes,
  addFrame: q.insertFrame,
  finalizeFrame: q.finalizeFrame,
  removeProvisionalFrame: q.removeProvisionalFrame,
  touchUpload: q.touchUpload,
  insertUpload: q.insertUpload,
  completeUpload: q.completeUpload,
  abortUpload: q.abortUpload,
  findStaleUploads: q.findStaleUploads,
  listUploadIds: q.listUploadIds,
  findFrameAt: q.findFrameAt,
  findOwnOriginalFrame: q.findOwnOriginalFrame,
  saveRotatedFrame: q.saveRotatedFrame,
  findImport: (id: string) => q.findImport(id, null),
  takeImportItem: q.takeImportItem,
  setImportItem: q.setImportItem,
  requeueImportItems: q.requeueImportItems,
};

// ── пользователи и сессии (используются из lib/auth) ──

export type { UserRecord, OAuthProfile } from "./queries";

/** Если у владельца ещё нет своей записи, ему достаётся пользователь с данными из seed */
export async function findOrCreateOAuthUser(profile: q.OAuthProfile, isOwner: boolean): Promise<q.UserRecord> {
  await connection();
  return q.findOrCreateOAuthUser(profile, isOwner ? DEFAULT_USER_ID : null);
}

export async function createSession(tokenHash: string, userId: number, expiresAt: number): Promise<void> {
  await connection();
  q.insertSession(tokenHash, userId, expiresAt);
}

/** renew: продлить сессию до renew.until, если она истекает раньше renew.ifBefore (секунды Unix) */
export async function getSessionUser(tokenHash: string, renew?: { until: number; ifBefore: number }): Promise<q.UserRecord | null> {
  await connection();
  return q.findSessionUser(tokenHash, renew);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await connection();
  q.removeSession(tokenHash);
}
