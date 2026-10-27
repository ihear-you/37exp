import sharp from "sharp";
import { background } from "../db";
import { log, mb, since } from "../log";
import { readOriginal, savePhoto } from "../storage";
import { rotateJpegClockwise } from "./orientation";
import { MAX_PIXELS, processPhoto } from "./process";
import { withPhotoSlot } from "./queue";

// Поворот кадра на 90° по часовой. Поворачивается сам оригинал, копии для ленты и просмотра делаются заново.
//   JPEG — без потерь: меняется только отметка ориентации в EXIF (lib/photos/orientation.ts), пиксели те же;
//   PNG, TIFF — пересохраняются без потерь (у 16-битных TIFF глубина сохраняется); WebP — в режим без потерь.
// Другие форматы (HEIC и прочие) сервер записать не умеет: их повернуть нельзя.

export type RotateError = "format" | "roll" | "storage" | "busy";

// один и тот же кадр не поворачиваем дважды одновременно (двойной клик)
const g = globalThis as typeof globalThis & { __plenkaRotating?: Set<string> };
const rotating = (g.__plenkaRotating ??= new Set<string>());

async function rotateOriginal(data: Buffer, ext: string): Promise<Buffer | null> {
  if (ext === "jpg") return rotateJpegClockwise(data);
  if (ext !== "png" && ext !== "tif" && ext !== "webp") return null;
  const meta = await sharp(data).metadata();
  // сначала применяем прежнюю отметку ориентации, потом поворачиваем: в результате отметки уже нет
  let img = sharp(data, { limitInputPixels: MAX_PIXELS }).autoOrient().rotate(90);
  if (meta.depth === "ushort") img = img.toColourspace((meta.channels ?? 3) >= 3 ? "rgb16" : "grey16");
  if (ext === "png") return img.png({ compressionLevel: 9 }).toBuffer();
  if (ext === "tif") return img.tiff({ compression: "lzw" }).toBuffer();
  return img.webp({ lossless: true }).toBuffer();
}

export async function rotatePhoto(userId: number, frameId: string): Promise<{ status: "ok"; v: number; w: number; h: number } | { status: "error"; error: RotateError }> {
  if (!background.findOwnOriginalFrame(userId, frameId)) return { status: "error", error: "roll" };
  if (rotating.has(frameId)) return { status: "error", error: "busy" };
  rotating.add(frameId);
  const start = Date.now();
  try {
    const original = await readOriginal(userId, frameId);
    if (!original) return { status: "error", error: "storage" };
    let rotated: Buffer | null;
    try {
      // PNG, TIFF и WebP пересохраняются целиком: это тяжёлая работа, через общую очередь (queue.ts)
      rotated = await withPhotoSlot(`кадр ${frameId}: поворот`, () => rotateOriginal(original.data, original.ext));
    } catch {
      return { status: "error", error: "format" };
    }
    if (!rotated) return { status: "error", error: "format" };

    const photo = await processPhoto(rotated, `кадр ${frameId}`);
    try {
      // keepOnFailure: если запись не удалась, прежние файлы кадра остаются, кадр не пропадает
      await savePhoto(userId, frameId, { original: { data: rotated, ext: original.ext }, feed: photo.feed, full: photo.full }, { keepOnFailure: true });
    } catch {
      return { status: "error", error: "storage" };
    }
    const { w, h, hue, sat, light, color } = photo;
    const v = background.saveRotatedFrame(userId, frameId, { w, h, hue, sat, light, color, bytes: rotated.length });
    if (v === null) return { status: "error", error: "roll" };
    log("ingest", `кадр ${frameId}: повёрнут (${original.ext}, ${mb(original.data.length)} → ${mb(rotated.length)}) за ${since(start)} мс`);
    return { status: "ok", v, w, h };
  } finally {
    rotating.delete(frameId);
  }
}
