import type { Camera, Film, Format, Frame, Roll, RollEdit, Visibility } from "../catalog";
import { randomBytes } from "node:crypto";
import { getDb } from "./connection";
import { uniqueHandle } from "./handle";

// Запросы к SQLite. Синхронные, наружу не торчат: страницы работают через lib/db/index.ts.
// Чтобы перейти на размещённую базу, достаточно переписать этот файл (и connection.ts).
// Все запросы привязаны к владельцу (user_id): чужие плёнки и кадры не видны и не меняются.

interface RollRow {
  id: number;
  film_id: string;
  camera_id: string | null;
  format: Format;
  iso: number | null;
  year: number;
  month: number;
  title: string | null;
  description: string;
  visibility: Visibility;
  share_key: string | null;
  user_id: number;
  count: number;
}

const toRoll = (r: RollRow): Roll => ({
  id: r.id,
  filmId: r.film_id,
  format: r.format,
  iso: r.iso,
  cameraId: r.camera_id ?? "",
  year: r.year,
  month: r.month,
  description: r.description,
  title: r.title,
  visibility: r.visibility,
  shareKey: r.share_key ?? undefined,
});

interface FrameRow {
  id: string;
  roll_id: number;
  idx: number;
  w: number;
  h: number;
  hue: number;
  sat: number;
  light: number;
  color: string;
}

const toFrame = (f: FrameRow): Frame => ({
  id: f.id,
  roll: f.roll_id,
  idx: f.idx,
  w: f.w,
  h: f.h,
  hue: f.hue,
  sat: f.sat,
  light: f.light,
  color: f.color,
});

const FRAME_COLUMNS = "f.id, f.roll_id, f.idx, f.w, f.h, f.hue, f.sat, f.light, f.color";

const ROLL_SELECT = `
  SELECT r.id, r.user_id, r.film_id, r.camera_id, r.format, r.iso, r.year, r.month, r.title, r.description,
         r.visibility, r.share_key,
         (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id AND f.deleted_at IS NULL) AS count
  FROM rolls r`;

/** Плёнки пользователя; onlyPublic: только открытые всем (для чужого взгляда) */
export function listRolls(userId: number, onlyPublic = false): { roll: Roll; count: number }[] {
  const rows = getDb()
    .prepare(`${ROLL_SELECT} WHERE r.user_id = ? ${onlyPublic ? "AND r.visibility = 'public'" : ""} ORDER BY r.id`)
    .all(userId) as RollRow[];
  return rows.map((r) => ({ roll: toRoll(r), count: r.count }));
}

/** Плёнка любого пользователя по номеру: кто её может видеть, решает вызывающий (lib/access.ts) */
export function findRoll(id: number): { roll: Roll; ownerId: number; count: number } | null {
  const row = getDb().prepare(`${ROLL_SELECT} WHERE r.id = ?`).get(id) as RollRow | undefined;
  return row ? { roll: toRoll(row), ownerId: row.user_id, count: row.count } : null;
}

export function listCameras(userId: number): Camera[] {
  return getDb().prepare("SELECT id, name FROM cameras WHERE user_id = ? ORDER BY rowid").all(userId) as Camera[];
}

export function countAll(userId: number): { rolls: number; frames: number } {
  return getDb()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM rolls WHERE user_id = @userId) AS rolls,
              (SELECT COUNT(*) FROM frames f JOIN rolls r ON r.id = f.roll_id
                WHERE r.user_id = @userId AND f.deleted_at IS NULL) AS frames`,
    )
    .get({ userId }) as { rolls: number; frames: number };
}

export function listFramesOfRoll(userId: number, rollId: number): Frame[] {
  const rows = getDb()
    .prepare(
      `SELECT ${FRAME_COLUMNS} FROM frames f JOIN rolls r ON r.id = f.roll_id
       WHERE r.user_id = ? AND f.roll_id = ? AND f.deleted_at IS NULL ORDER BY f.idx`,
    )
    .all(userId, rollId) as FrameRow[];
  return rows.map(toFrame);
}

export function listAllFrames(userId: number): Frame[] {
  const rows = getDb()
    .prepare(
      `SELECT ${FRAME_COLUMNS} FROM frames f JOIN rolls r ON r.id = f.roll_id
       WHERE r.user_id = ? AND f.deleted_at IS NULL ORDER BY f.roll_id, f.idx`,
    )
    .all(userId) as FrameRow[];
  return rows.map(toFrame);
}

/** Первые `perRoll` кадров каждой плёнки (для веера на карточке папки) */
export function listFramePreviews(userId: number, perRoll: number, onlyPublic = false): Frame[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT ${FRAME_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY f.roll_id ORDER BY f.idx) AS n
         FROM frames f JOIN rolls r ON r.id = f.roll_id
         WHERE r.user_id = ? AND f.deleted_at IS NULL ${onlyPublic ? "AND r.visibility = 'public'" : ""}
       ) WHERE n <= ? ORDER BY roll_id, idx`,
    )
    .all(userId, perRoll) as FrameRow[];
  return rows.map(toFrame);
}

/** Данные новой плёнки. Доступ сюда намеренно не входит: новая плёнка всегда «только я». */
export type NewRoll = Omit<RollEdit, "visibility">;

/** Создаёт плёнку пользователя и возвращает её номер. Доступ «только я» и ключ для ссылки ставятся здесь. */
export function insertRoll(userId: number, r: NewRoll): number {
  const res = getDb()
    .prepare(
      `INSERT INTO rolls (user_id, film_id, camera_id, format, iso, year, month, title, description, visibility, share_key)
       VALUES (@userId, @filmId, @cameraId, @format, @iso, @year, @month, @title, @description, 'private', @shareKey)`,
    )
    .run({ ...r, cameraId: r.cameraId || null, userId, shareKey: randomBytes(9).toString("hex") });
  return Number(res.lastInsertRowid);
}

/** false, если плёнки нет или она чужая */
export function saveRoll(userId: number, id: number, e: RollEdit): boolean {
  const res = getDb()
    .prepare(
      `UPDATE rolls SET title = @title, description = @description, film_id = @filmId, camera_id = @cameraId,
              iso = @iso, format = @format, month = @month, year = @year, visibility = @visibility,
              updated_at = datetime('now')
       WHERE id = @id AND user_id = @userId`,
    )
    .run({ ...e, cameraId: e.cameraId || null, id, userId });
  return res.changes > 0;
}

/** Кадр не стирается, а помечается удалённым. false, если кадра нет или он чужой */
export function markFrameDeleted(userId: number, frameId: string): boolean {
  const res = getDb()
    .prepare(
      `UPDATE frames SET deleted_at = datetime('now')
       WHERE id = ? AND deleted_at IS NULL AND roll_id IN (SELECT id FROM rolls WHERE user_id = ?)`,
    )
    .run(frameId, userId);
  return res.changes > 0;
}

// ── пользователи и сессии ──

export interface UserRecord {
  id: number;
  /** Адрес страницы автора: /u/<handle> */
  handle: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface OAuthProfile {
  provider: string;
  /** Идентификатор пользователя у провайдера */
  id: string;
  /** Подтверждённая провайдером почта в нижнем регистре */
  email: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Пользователь по аккаунту у провайдера входа. Порядок поиска:
 * 1) этот аккаунт уже входил;
 * 2) есть пользователь с такой же почтой (вошёл другим способом): подключаем этот способ к нему;
 * 3) это владелец, а пользователь по умолчанию (с данными из seed) ещё ни с кем не связан:
 *    вход «забирает» его, и владелец сразу видит свои плёнки;
 * 4) иначе заводится новый пользователь.
 */
export function findOrCreateOAuthUser(profile: OAuthProfile, claimDefaultUserId: number | null): UserRecord {
  const db = getDb();
  return db
    .transaction(() => {
      let id = (
        db.prepare("SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_id = ?").get(profile.provider, profile.id) as
          | { user_id: number }
          | undefined
      )?.user_id;
      if (id === undefined) {
        id = (db.prepare("SELECT id FROM users WHERE email = ?").get(profile.email) as { id: number } | undefined)?.id;
      }
      if (id === undefined && claimDefaultUserId !== null) {
        const free = db
          .prepare("SELECT 1 FROM users u WHERE u.id = ? AND NOT EXISTS (SELECT 1 FROM oauth_accounts a WHERE a.user_id = u.id)")
          .get(claimDefaultUserId);
        if (free) id = claimDefaultUserId;
      }
      if (id === undefined) {
        id = Number(
          db
            .prepare("INSERT INTO users (name, email, handle) VALUES (?, ?, ?)")
            .run(profile.name, profile.email, uniqueHandle(db, profile.email)).lastInsertRowid,
        );
      } else if (id === claimDefaultUserId) {
        // пользователь из seed достался владельцу: адрес страницы теперь по его почте
        db.prepare("UPDATE users SET handle = ? WHERE id = ? AND handle = 'user'").run(uniqueHandle(db, profile.email), id);
      }
      db.prepare("INSERT OR IGNORE INTO oauth_accounts (provider, provider_id, user_id) VALUES (?, ?, ?)").run(
        profile.provider,
        profile.id,
        id,
      );
      // почту не меняем, если она уже у другого пользователя (она уникальна)
      db.prepare(
        `UPDATE users SET name = @name, avatar_url = @avatarUrl,
           email = CASE WHEN EXISTS (SELECT 1 FROM users WHERE email = @email AND id <> @id) THEN email ELSE @email END
         WHERE id = @id`,
      ).run({ name: profile.name, avatarUrl: profile.avatarUrl, email: profile.email, id });
      return db.prepare("SELECT id, handle, name, email, avatar_url AS avatarUrl FROM users WHERE id = ?").get(id) as UserRecord;
    })
    .immediate();
}

/** tokenHash: sha256 токена из cookie; expiresAt: секунды Unix */
export function insertSession(tokenHash: string, userId: number, expiresAt: number) {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Math.floor(Date.now() / 1000));
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function findUserById(id: number): UserRecord | null {
  const row = getDb().prepare("SELECT id, handle, name, email, avatar_url AS avatarUrl FROM users WHERE id = ?").get(id) as
    | UserRecord
    | undefined;
  return row ?? null;
}

export function findUserByHandle(handle: string): UserRecord | null {
  const row = getDb().prepare("SELECT id, handle, name, email, avatar_url AS avatarUrl FROM users WHERE handle = ?").get(handle) as
    | UserRecord
    | undefined;
  return row ?? null;
}

export function findSessionUser(tokenHash: string): UserRecord | null {
  const row = getDb()
    .prepare(
      `SELECT u.id, u.handle, u.name, u.email, u.avatar_url AS avatarUrl
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(tokenHash, Math.floor(Date.now() / 1000)) as UserRecord | undefined;
  return row ?? null;
}

export function removeSession(tokenHash: string) {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(tokenHash);
}

// ── плёнки и камеры пользователя ──

export function listUserFilms(userId: number): Film[] {
  const rows = getDb().prepare("SELECT id, name, iso FROM user_films WHERE user_id = ? ORDER BY rowid").all(userId) as {
    id: string;
    name: string;
    iso: number | null;
  }[];
  return rows.map((r) => ({ ...r, synonyms: [] }));
}

export function insertUserFilm(userId: number, name: string, iso: number | null): Film {
  const id = `u-${randomBytes(4).toString("hex")}`;
  getDb().prepare("INSERT INTO user_films (user_id, id, name, iso) VALUES (?, ?, ?, ?)").run(userId, id, name, iso);
  return { id, name, iso, synonyms: [] };
}

export function insertCamera(userId: number, name: string): Camera {
  const id = `c-${randomBytes(4).toString("hex")}`;
  getDb().prepare("INSERT INTO cameras (user_id, id, name) VALUES (?, ?, ?)").run(userId, id, name);
  return { id, name };
}

// ── загрузка кадров ──

/**
 * Резервирует `count` подряд идущих номеров кадров в плёнке пользователя и возвращает первый.
 * null, если плёнки нет или она чужая. Номера из разных загрузок не пересекаются.
 */
export function reserveFrameSlots(userId: number, rollId: number, count: number): number | null {
  const db = getDb();
  return db
    .transaction(() => {
      const row = db
        .prepare(
          `SELECT r.next_idx AS next, COALESCE((SELECT MAX(idx) FROM frames WHERE roll_id = r.id), 0) AS maxIdx
           FROM rolls r WHERE r.id = ? AND r.user_id = ?`,
        )
        .get(rollId, userId) as { next: number; maxIdx: number } | undefined;
      if (!row) return null;
      const first = Math.max(row.next, row.maxIdx + 1);
      db.prepare("UPDATE rolls SET next_idx = ? WHERE id = ?").run(first + count, rollId);
      return first;
    })
    .immediate();
}

export interface NewFrame {
  id: string;
  idx: number;
  w: number;
  h: number;
  hue: number;
  sat: number;
  light: number;
  color: string;
  bytes: number;
}

/** "exists": кадр с таким номером в плёнке уже есть (повторная отправка); "forbidden": плёнки нет или она чужая */
export function insertFrame(userId: number, rollId: number, f: NewFrame): "ok" | "exists" | "forbidden" {
  const db = getDb();
  return db
    .transaction((): "ok" | "exists" | "forbidden" => {
      if (!db.prepare("SELECT 1 FROM rolls WHERE id = ? AND user_id = ?").get(rollId, userId)) return "forbidden";
      if (db.prepare("SELECT 1 FROM frames WHERE roll_id = ? AND idx = ?").get(rollId, f.idx)) return "exists";
      db.prepare(
        "INSERT INTO frames (id, roll_id, idx, w, h, hue, sat, light, color, bytes) VALUES (@id, @rollId, @idx, @w, @h, @hue, @sat, @light, @color, @bytes)",
      ).run({ ...f, rollId });
      return "ok";
    })
    .immediate();
}

/** Сколько байт оригиналов лежит у пользователя (удалённые кадры тоже занимают место) */
export function userStorageBytes(userId: number): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(f.bytes), 0) AS total FROM frames f JOIN rolls r ON r.id = f.roll_id WHERE r.user_id = ?")
    .get(userId) as { total: number };
  return row.total;
}

// ── доступ к файлам и ссылкам ──

export interface FrameAccess {
  ownerId: number;
  visibility: Visibility;
  shareKey: string | null;
}

/** Чьё это кадр и кто его может видеть. null, если кадра нет или он удалён */
export function findFrameAccess(frameId: string): FrameAccess | null {
  const row = getDb()
    .prepare(
      `SELECT r.user_id AS ownerId, r.visibility, r.share_key AS shareKey
       FROM frames f JOIN rolls r ON r.id = f.roll_id WHERE f.id = ? AND f.deleted_at IS NULL`,
    )
    .get(frameId) as FrameAccess | undefined;
  return row ?? null;
}

/** Номер плёнки по ключу ссылки */
export function findRollIdByShareKey(key: string): { id: number; visibility: Visibility } | null {
  const row = getDb().prepare("SELECT id, visibility FROM rolls WHERE share_key = ?").get(key) as
    | { id: number; visibility: Visibility }
    | undefined;
  return row ?? null;
}
