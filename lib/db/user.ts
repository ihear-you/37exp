// Чей архив показывает сайт. Зрители заходят без входа и видят архив владельца, поэтому
// чтение идёт от этого пользователя. Писать (править, удалять) может только вошедший владелец,
// его id приходит из сессии (lib/auth), а не отсюда.
// Первый вход владельца через Google «забирает» этого пользователя (см. findOrCreateGoogleUser
// в queries.ts), поэтому плёнки и кадры из seed остаются его.

export const DEFAULT_USER_ID = 1;
export const DEFAULT_USER_NAME = "Я";

export async function archiveUserId(): Promise<number> {
  return DEFAULT_USER_ID;
}
