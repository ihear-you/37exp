import sharp from "sharp";
import { withPhotoSlot } from "./queue";

// Обработка загруженного кадра: поворот по EXIF, копии для ленты и для просмотра на весь экран,
// цвет и яркость для ленты. Те же размеры и качество, что у scripts/import-photos.mjs.
// Работа тяжёлая, поэтому идёт через общую очередь сервера (queue.ts).

const LONG_FEED = 900;
const LONG_FULL = 2000;
/** Защита от «бомб» — огромных по размеру картинок — и от нехватки памяти: скан 35 мм около 24 млн пикселей,
 *  крупный скан 6×9 около 120 млн */
export const MAX_PIXELS = 200_000_000;

export interface Processed {
  /** Формат исходника: jpeg, png, tiff, webp… */
  format: string;
  feed: Buffer;
  full: Buffer;
  w: number;
  h: number;
  hue: number;
  sat: number;
  light: number;
  color: string;
}

/** Кидает ошибку, если файл не картинка или не читается. label — для журнала */
export function processPhoto(input: Buffer, label: string): Promise<Processed> {
  return withPhotoSlot(label, () => makeRenditions(input));
}

async function makeRenditions(input: Buffer): Promise<Processed> {
  // поворот по EXIF применяем один раз, дальше работаем с уже «прямой» картинкой
  // Поворот по EXIF и уменьшение идут одной цепочкой для каждой копии: так оригинал не пересохраняется
  // целиком в промежуточный файл (на сервере это заметная доля времени), а результат тот же.
  const source = sharp(input, { limitInputPixels: MAX_PIXELS });
  const format = (await source.metadata()).format ?? "";
  const upright = source.rotate();

  const full = await upright
    .clone()
    .resize({ width: LONG_FULL, height: LONG_FULL, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  const feed = await upright
    .clone()
    .resize({ width: LONG_FEED, height: LONG_FEED, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  const { width, height } = await sharp(feed).metadata();
  const raw = await sharp(feed).resize(24, 24, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return { format, feed, full, w: width, h: height, ...analyze(raw) };
}

/** Размер, цвет и яркость готовой картинки без пересжатия (для временной копии от источника). Кидает ошибку, если это не картинка */
export async function describePhoto(input: Buffer): Promise<Omit<Processed, "feed" | "full">> {
  const image = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
  const { data, info } = await image.clone().toBuffer({ resolveWithObject: true });
  const raw = await sharp(data).resize(24, 24, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return { format: info.format, w: info.width, h: info.height, ...analyze(raw) };
}

/** Цвет и яркость по уменьшенной картинке 24×24 */
function analyze(raw: Buffer) {
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
