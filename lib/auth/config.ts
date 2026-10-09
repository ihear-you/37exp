// Настройки входа из переменных окружения (.env.local, образец в .env.example).

/** Адрес сайта, как его видит браузер. Из него строится адрес возврата от Google, поэтому
    он должен совпадать с тем, что записано в консоли Google (порт тоже). */
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Cookie с флагом Secure ставим только когда сайт открыт по https */
export const secureCookies = () => appUrl().startsWith("https://");

/** Почты владельцев сайта через запятую. Права записи есть у любого вошедшего (у каждого свой архив),
    а владелец при первом входе получает архив из seed (плёнки и кадры, которые уже лежат в базе). */
export const ownerEmails = () =>
  (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isOwnerEmail = (email: string | null | undefined) => !!email && ownerEmails().includes(email.toLowerCase());

export const googleCredentials = () => credentials(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
export const yandexCredentials = () => credentials(process.env.YANDEX_CLIENT_ID, process.env.YANDEX_CLIENT_SECRET);

function credentials(id: string | undefined, secret: string | undefined) {
  return id && secret ? { id, secret } : null;
}

/** Адрес возврата для провайдера: его же нужно записать в настройках приложения у Google или Яндекса */
export const redirectUri = (provider: string) => `${appUrl()}/api/auth/${provider}/callback`;

/** Куда вернуться после входа: только путь внутри сайта */
export function safeNext(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}
