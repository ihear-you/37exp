import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "./schema";
import { seedIfEmpty } from "./seed";

// Файл базы: data/plenka.db в корне проекта (или PLENKA_DB_PATH). Создаётся и заполняется
// при первом обращении. Начать с чистого листа: npm run db:reset.
const DB_PATH = process.env.PLENKA_DB_PATH ?? path.join(process.cwd(), "data", "plenka.db");

function open() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedIfEmpty(db);
  return db;
}

// В dev модуль перезагружается при правках, поэтому соединение держим на globalThis
const g = globalThis as typeof globalThis & { __plenkaDb?: Database.Database };
export const getDb = () => (g.__plenkaDb ??= open());
