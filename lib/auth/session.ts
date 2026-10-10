import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { createSession, deleteSession, getSessionUser } from "@/lib/db";
import { FRESH_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE, SESSION_RENEW_EVERY, sessionCookieOptions } from "./cookie";

// Сессии на сервере: в cookie лежит случайный токен, в базе только его sha256. Токен нельзя
// подделать или вычислить из базы, а выйти можно, удалив строку. Cookie httpOnly: скрипты
// страницы её не видят.
// Срок считается от последнего захода (SESSION_MAX_AGE в cookie.ts): запись в базе продлевает
// getViewer, cookie в браузере — proxy.ts, оба не чаще раза в сутки.

const now = () => Math.floor(Date.now() / 1000);

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
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await getSessionUser(hash(token), {
    until: now() + SESSION_MAX_AGE,
    ifBefore: now() + SESSION_MAX_AGE - SESSION_RENEW_EVERY,
  });
  return user ?? null;
});

/** Для серверных действий и маршрутов: вошедший пользователь или null. Он работает только со своими данными. */
export const requireUser = getViewer;

export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  await createSession(hash(token), userId, now() + SESSION_MAX_AGE);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
  store.set(FRESH_COOKIE, "1", sessionCookieOptions(SESSION_RENEW_EVERY));
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(hash(token));
  store.delete(SESSION_COOKIE);
  store.delete(FRESH_COOKIE);
}
