import { secureCookies } from "./config";

// Cookie входа и срок её жизни. Отдельный файл без базы: им пользуется и proxy.ts, который
// выполняется до страниц и не должен тянуть за собой серверные модули (lib/db и прочее).

export const SESSION_COOKIE = "session";
/** Пометка «срок сегодня уже продлевали»: пока она есть, proxy.ts cookie входа не трогает */
export const FRESH_COOKIE = "session_fresh";

/** Вход держится 90 дней с последнего захода на сайт */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90;
/** Срок продлевается не чаще раза в сутки */
export const SESSION_RENEW_EVERY = 60 * 60 * 24;

/** httpOnly: скрипты страницы cookie не видят */
export const sessionCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
