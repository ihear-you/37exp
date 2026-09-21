// Импорт настоящих кадров в прототип: «представим, что они уже загружены».
// Запуск: npm run import
//
// Для каждого кадра делаются две копии: облегчённая для ленты (public/photos/f)
// и крупная для просмотра на весь экран (public/photos/l). Поворот берётся из EXIF.
// Цвет и яркость считаются по готовой картинке, так же как это будет при загрузке.
// Оригиналы остаются на месте и в проект не копируются.
// Результат: lib/photos/frames.json. Данные о плёнках (камера, дата, описание) лежат в lib/catalog.ts.

import sharp from "sharp";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOWNLOADS = "/Users/kristina/Downloads";

// номер плёнки в lib/catalog.ts → папка с кадрами
const SOURCES = [
  { roll: 1, dir: path.join(DOWNLOADS, "Lucky Color 200 Корея (01.04-15.04)") },
  { roll: 2, dir: path.join(DOWNLOADS, "Tasma T-42L (Июль 2026)") },
];

const LONG_FEED = 900;
const LONG_FULL = 2000;

const DIR_FEED = path.join(ROOT, "public/photos/f");
const DIR_FULL = path.join(ROOT, "public/photos/l");
const OUT_JSON = path.join(ROOT, "lib/photos/frames.json");

/** Цвет и яркость по уменьшенной картинке 24×24 */
function analyze(raw) {
  let x = 0;
  let y = 0;
  let sumS = 0;
  let sumL = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = raw.length / 3;
  for (let i = 0; i < n; i++) {
    const R = raw[i * 3] / 255;
    const G = raw[i * 3 + 1] / 255;
    const B = raw[i * 3 + 2] / 255;
    r += raw[i * 3];
    g += raw[i * 3 + 1];
    b += raw[i * 3 + 2];
    const mx = Math.max(R, G, B);
    const mn = Math.min(R, G, B);
    const d = mx - mn;
    const l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      if (mx === R) h = ((G - B) / d) % 6;
      else if (mx === G) h = (B - R) / d + 2;
      else h = (R - G) / d + 4;
      h *= 60;
    }
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad) * s;
    y += Math.sin(rad) * s;
    sumS += s;
    sumL += 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const hex = [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
  return {
    hue: Math.round(hue),
    sat: +(sumS / n).toFixed(3),
    light: +(sumL / n).toFixed(3),
    color: `#${hex}`,
  };
}

rmSync(path.join(ROOT, "public/photos"), { recursive: true, force: true });
mkdirSync(DIR_FEED, { recursive: true });
mkdirSync(DIR_FULL, { recursive: true });
mkdirSync(path.dirname(OUT_JSON), { recursive: true });

const frames = [];
let bytesFeed = 0;
let bytesFull = 0;

for (const { roll, dir } of SOURCES) {
  const files = readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  for (const [i, file] of files.entries()) {
    const id = `${String(roll).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    const src = path.join(dir, file);

    // поворот по EXIF применяем один раз, дальше работаем с уже «прямой» картинкой
    const upright = await sharp(src).rotate().toBuffer();

    const full = await sharp(upright)
      .resize({ width: LONG_FULL, height: LONG_FULL, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    writeFileSync(path.join(DIR_FULL, `${id}.jpg`), full);
    bytesFull += full.length;

    const feedImg = sharp(upright).resize({ width: LONG_FEED, height: LONG_FEED, fit: "inside", withoutEnlargement: true });
    const feed = await feedImg.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    writeFileSync(path.join(DIR_FEED, `${id}.jpg`), feed);
    bytesFeed += feed.length;

    const { width, height } = await sharp(feed).metadata();
    const raw = await sharp(feed).resize(24, 24, { fit: "fill" }).removeAlpha().raw().toBuffer();
    frames.push({ id, roll, idx: i + 1, w: width, h: height, ...analyze(raw) });
  }
  console.log(`плёнка ${roll}: ${files.length} кадров из «${path.basename(dir)}»`);
}

writeFileSync(OUT_JSON, JSON.stringify(frames));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`\nкадров: ${frames.length}`);
console.log(`лента: ${mb(bytesFeed)} МБ (в среднем ${Math.round(bytesFeed / frames.length / 1024)} КБ), крупные: ${mb(bytesFull)} МБ`);
