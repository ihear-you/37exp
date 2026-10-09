import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { createSession, deleteSession, getSessionUser } from "@/lib/db";
import { secureCookies } from "./config";

// Сессии на сервере: в cookie лежит случайный токен, в базе только его sha256. Токен нельзя
// подделать или вычислить из базы, а выйти можно, удалив строку. Cookie httpOnly: скрипты
// страницы её не видят.

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface Viewer {
  id: number;
  /** Адрес страницы автора: /u/<handle> */
  handle: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

/** Кто смотрит сайт: вошедший пользователь или null (обычный зритель). Один запрос на рендер. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const user = await getSessionUser(hash(token));
  return user ?? null;
});

/** Для серверных действий и маршрутов: вошедший пользователь или null. Он работает только со своими данными. */
export const requireUser = getViewer;

export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE;
  await createSession(hash(token), userId, expiresAt);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await deleteSession(hash(token));
  store.delete(COOKIE);
}
