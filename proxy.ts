import { NextResponse, type NextRequest } from "next/server";
import { FRESH_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE, SESSION_RENEW_EVERY, sessionCookieOptions } from "@/lib/auth/cookie";

// Продление входа. Сессия живёт 90 дней с последнего захода, а не со дня входа: раз в сутки
// cookie входа выдаётся заново с полным сроком. Здесь продлевается только cookie в браузере:
// страницы и серверные действия менять cookie при отрисовке не могут, а proxy может.
// Запись в базе продлевается отдельно, в getViewer (lib/auth/session.ts), и она же решает,
// настоящая ли сессия: proxy токен не проверяет и в базу не ходит.
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // только обычные заходы: выход и другие серверные действия (POST) сами меняют cookie входа
  if (request.method !== "GET" || !token) return response;
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
  response.cookies.set(FRESH_COOKIE, "1", sessionCookieOptions(SESSION_RENEW_EVERY));
  return response;
}

// Срабатывает, только когда cookie входа есть, а пометки о продлении нет, то есть не чаще раза в сутки.
// Названия cookie здесь записаны строками (SESSION_COOKIE и FRESH_COOKIE из lib/auth/cookie.ts):
// matcher разбирается при сборке и переменные не понимает.
export const config = {
  matcher: [
    {
      source: "/((?!api|photos|_next/static|_next/image|favicon.ico).*)",
      has: [{ type: "cookie", key: "session" }],
      missing: [{ type: "cookie", key: "session_fresh" }],
    },
  ],
};
