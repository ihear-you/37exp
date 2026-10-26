// Фото Unsplash для заставки (WelcomeReel) и веера над плитками загрузки хранятся на самом сайте:
// images.unsplash.com из России без VPN не открывается, и вместо фото оставались цветные квадраты.
// Лицензия Unsplash разрешает скачивать фото и использовать их на своём сайте; авторов храним для подписи.
//
// Запуск (нужен UNSPLASH_ACCESS_KEY в .env.local, только для этого скрипта):
//   npm run editorial -- <id фото> <id фото> …
// id — из адреса фото на unsplash.com (https://unsplash.com/photos/<…-id>). Порядок важен: первые четыре —
// веер над плитками (по краям потом встают два самых цветастых, getFanPhotos). Скрипт кладёт фото в public/editorial/
// и список с авторами в lib/editorial.json, старые фото, которых нет в новом списке, удаляет.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const key = process.env.UNSPLASH_ACCESS_KEY;
// id можно перечислить через пробел или запятую, в одном аргументе или в нескольких
const ids = process.argv.slice(2).flatMap((a) => a.split(/[\s,]+/)).filter(Boolean);
if (!key) throw new Error("Нет UNSPLASH_ACCESS_KEY: запускайте через npm run editorial (он читает .env.local)");
if (!ids.length) throw new Error("Укажите id фото: npm run editorial -- <id> <id> …");

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "public", "editorial");
await mkdir(dir, { recursive: true });
const auth = { headers: { Authorization: `Client-ID ${key}` } };

// фото, которые уже есть в подборке, берём как есть: запросы к API тратятся только на новые (у ключа 50 в час)
const listFile = path.join(root, "lib", "editorial.json");
const known = new Map();
try {
  for (const p of JSON.parse(await readFile(listFile, "utf8"))) known.set(p.id, p);
} catch {
  // списка ещё нет
}

const photos = [];
for (const id of ids) {
  if (known.has(id) && existsSync(path.join(dir, `${id}.jpg`))) {
    photos.push(known.get(id));
    console.log(`= ${id} — уже есть`);
    continue;
  }
  const res = await fetch(`https://api.unsplash.com/photos/${encodeURIComponent(id)}`, auth);
  if (!res.ok) throw new Error(`Фото ${id}: ответ Unsplash ${res.status}${res.status === 403 ? " (кончился лимит 50 запросов в час, повторите позже: уже скачанные второй раз не запрашиваются)" : ""}`);
  const p = await res.json();
  // правило API Unsplash: скачивание засчитывается автору через download_location
  await fetch(p.links.download_location, auth);
  // 1200 px по длинной стороне: плитки заставки разгоняются через scale(), меньше — заметно мыльно (~100 КБ на фото)
  const img = await fetch(`${p.urls.raw}&w=1200&q=70&fm=jpg&fit=max`);
  if (!img.ok) throw new Error(`Фото ${id}: не скачалось (${img.status})`);
  const file = Buffer.from(await img.arrayBuffer());
  await writeFile(path.join(dir, `${p.id}.jpg`), file);
  const w = 1200;
  const h = Math.round((p.height / p.width) * w);
  photos.push({
    id: p.id,
    src: `/editorial/${p.id}.jpg`,
    w: p.width >= p.height ? w : Math.round((p.width / p.height) * w),
    h: p.width >= p.height ? h : w,
    color: p.color ?? "#d9d9d9",
    alt: p.alt_description ?? "",
    vivid: await colorfulness(file),
    credit: { name: p.user.name, url: `${p.user.links.html}?utm_source=photo-lab&utm_medium=referral` },
  });
  console.log(`✓ ${p.id} — ${p.user.name}`);
}

// сохраняем список и для старых фото без оценки яркости
for (const p of photos) p.vivid ??= await colorfulness(await readFile(path.join(dir, `${p.id}.jpg`)));

const keep = new Set(photos.map((p) => `${p.id}.jpg`));
for (const f of await readdir(dir)) if (!keep.has(f)) await unlink(path.join(dir, f));
await writeFile(listFile, JSON.stringify(photos, null, 2) + "\n");
console.log(`Готово: ${photos.length} фото в public/editorial, список в lib/editorial.json`);

/**
 * Насколько фото цветастое (0 — ч/б, 80+ — очень яркое): мера Хаслера и Зюсструнка по пикселям уменьшенной копии.
 * По ней getFanPhotos ставит по краям веера самые яркие фото; «основной цвет» от Unsplash для этого слишком груб
 */
async function colorfulness(jpeg) {
  const { data } = await sharp(jpeg).resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rg = [];
  const yb = [];
  for (let i = 0; i < data.length; i += 3) {
    rg.push(data[i] - data[i + 1]);
    yb.push((data[i] + data[i + 1]) / 2 - data[i + 2]);
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => {
    const mu = mean(a);
    return Math.sqrt(mean(a.map((x) => (x - mu) ** 2)));
  };
  return Math.round(Math.hypot(sd(rg), sd(yb)) + 0.3 * Math.hypot(mean(rg), mean(yb)));
}
