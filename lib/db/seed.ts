import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { CAMERAS, FRAMES, ROLLS } from "../catalog";
import { uniqueHandle } from "./handle";
import { DEFAULT_USER_ID, DEFAULT_USER_NAME } from "./user";

/**
 * Заполняет пустую базу плёнками, камерами и кадрами из lib/catalog.ts и lib/photos/frames.json.
 * PLENKA_SEED=0 отключает это: база остаётся пустой (так на сервере).
 */
export function seedIfEmpty(db: Database.Database) {
  if (process.env.PLENKA_SEED === "0") return;
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) return;

    db.prepare("INSERT INTO users (id, name, handle) VALUES (?, ?, ?)").run(DEFAULT_USER_ID, DEFAULT_USER_NAME, uniqueHandle(db, "user"));

    const camera = db.prepare("INSERT INTO cameras (user_id, id, name) VALUES (?, ?, ?)");
    for (const c of CAMERAS) camera.run(DEFAULT_USER_ID, c.id, c.name);

    const roll = db.prepare(
      `INSERT INTO rolls (id, user_id, film_id, camera_id, format, iso, year, month, description, share_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of ROLLS) {
      roll.run(r.id, DEFAULT_USER_ID, r.filmId, r.cameraId || null, r.format, r.iso, r.year, r.month, r.description, randomBytes(9).toString("hex"));
    }

    const frame = db.prepare(
      "INSERT INTO frames (id, roll_id, idx, w, h, hue, sat, light, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const f of FRAMES) frame.run(f.id, f.roll, f.idx, f.w, f.h, f.hue, f.sat, f.light, f.color);
  }).immediate();
}
