import { decodeIdToken, Google, Yandex } from "arctic";
import { googleCredentials, redirectUri, yandexCredentials } from "./config";
import type { OAuthProfile } from "@/lib/db";

// Способы входа. Чтобы добавить ещё один, нужен только новый объект в PROVIDERS.

export type ProviderId = "google" | "yandex";

interface Provider {
  label: string;
  configured: () => boolean;
  /** Адрес, на который отправляем человека. verifier нужен только провайдерам с PKCE */
  authorizationUrl: (state: string, verifier: string) => URL;
  /** Меняет код на профиль. null, если провайдер не отдал подтверждённую почту */
  fetchProfile: (code: string, verifier: string) => Promise<OAuthProfile | null>;
}

const google = () => {
  const c = googleCredentials();
  return c ? new Google(c.id, c.secret, redirectUri("google")) : null;
};
const yandex = () => {
  const c = yandexCredentials();
  return c ? new Yandex(c.id, c.secret, redirectUri("yandex")) : null;
};

const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    label: "Google",
    configured: () => googleCredentials() !== null,
    authorizationUrl: (state, verifier) => google()!.createAuthorizationURL(state, verifier, ["openid", "profile", "email"]),
    async fetchProfile(code, verifier) {
      // токен пришёл напрямую от Google по https в ответ на наш код, подпись проверять не нужно
      const claims = decodeIdToken((await google()!.validateAuthorizationCode(code, verifier)).idToken()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      };
      if (!claims.sub || !claims.email || claims.email_verified !== true) return null;
      return {
        provider: "google",
        id: claims.sub,
        email: claims.email.toLowerCase(),
        name: claims.name || claims.email,
        avatarUrl: claims.picture ?? null,
      };
    },
  },

  yandex: {
    label: "Яндекс",
    configured: () => yandexCredentials() !== null,
    // права (почта, имя, портрет) берутся из настроек приложения на oauth.yandex.ru
    authorizationUrl: (state) => yandex()!.createAuthorizationURL(state, []),
    async fetchProfile(code) {
      const token = (await yandex()!.validateAuthorizationCode(code)).accessToken();
      const res = await fetch("https://login.yandex.ru/info?format=json", {
        headers: { Authorization: `OAuth ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Yandex: ${res.status}`);
      const info = (await res.json()) as {
        id?: string;
        login?: string;
        default_email?: string;
        display_name?: string;
        real_name?: string;
        default_avatar_id?: string;
        is_avatar_empty?: boolean;
      };
      if (!info.id || !info.default_email) return null;
      return {
        provider: "yandex",
        id: info.id,
        email: info.default_email.toLowerCase(),
        name: info.display_name || info.real_name || info.login || info.default_email,
        avatarUrl:
          info.default_avatar_id && !info.is_avatar_empty
            ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`
            : null,
      };
    },
  },
};

export const isProvider = (id: string): id is ProviderId => Object.hasOwn(PROVIDERS, id);
export const getProvider = (id: ProviderId) => PROVIDERS[id];

/** Способы входа с заполненными ключами; Яндекс первым (на проде он единственный) */
export const configuredProviders = () =>
  (["yandex", "google"] as ProviderId[]).filter((id) => PROVIDERS[id].configured()).map((id) => ({ id, label: PROVIDERS[id].label }));

/**
 * Куда вести «Войти»: сразу к сервису входа, своей страницы входа у сайта нет. next — куда вернуться после входа.
 * Если ключей нет ни у одного сервиса — на главную, там заставка скажет, что вход не настроен
 */
export function signInHref(next: string) {
  const provider = configuredProviders()[0];
  return provider ? `/api/auth/${provider.id}?next=${encodeURIComponent(next)}` : "/?login=config";
}
