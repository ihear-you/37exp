// Удаляет локальную базу data/plenka.db: при следующем запуске сайта она создастся заново
// и заполнится плёнками и кадрами из lib/catalog.ts и lib/photos/frames.json.
// Всё, что вы сохранили в базе (правки папок, удалённые кадры), пропадёт.
// Запуск: npm run db:reset (остановите сайт перед этим)

import { rmSync } from "node:fs";
import path from "node:path";

const base = process.env.PLENKA_DB_PATH ?? path.resolve(import.meta.dirname, "../data/plenka.db");
for (const file of [base, `${base}-wal`, `${base}-shm`]) rmSync(file, { force: true });
console.log(`База удалена: ${base}. Она создастся заново при следующем запуске сайта.`);
