import { cookies } from "next/headers";
import { secureCookies } from "./config";

// Ключи ссылок «все, у кого есть ссылка». Зритель открывает /s/<ключ>, ключ запоминается в cookie,
// и по нему плёнка и её картинки открываются дальше (в самих адресах картинок ключа нет).

const COOKIE = "rk";
const MAX_KEYS = 40;
const KEY = /^[A-Za-z0-9]{8,64}$/;

export const isShareKey = (key: string) => KEY.test(key);

export async function readShareKeys(): Promise<string[]> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  return raw.split(",").filter(isShareKey);
}

export async function rememberShareKey(key: string) {
  const keys = [key, ...(await readShareKeys()).filter((k) => k !== key)].slice(0, MAX_KEYS);
  (await cookies()).set(COOKIE, keys.join(","), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
}
