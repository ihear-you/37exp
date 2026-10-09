import type Database from "better-sqlite3";

/** Адрес страницы автора (/u/<handle>) из почты или имени: латиница, цифры и дефис */
export function baseHandle(source: string) {
  const local = source.split("@")[0];
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || "user";
}

/** Свободный адрес: при совпадении дописывается номер (name, name-2, name-3…) */
export function uniqueHandle(db: Database.Database, source: string) {
  const base = baseHandle(source);
  const taken = db.prepare("SELECT 1 FROM users WHERE handle = ?");
  let handle = base;
  for (let n = 2; taken.get(handle); n++) handle = `${base}-${n}`;
  return handle;
}
