// Поворот JPEG на 90° по часовой без потерь: меняется только отметка ориентации (EXIF Orientation, тег 0x0112),
// пиксели не пересжимаются. Браузеры, просмотрщики и sharp (lib/photos/process.ts) показывают кадр с её учётом.
//
// Если отметка уже есть — она меняется на месте. Если EXIF есть, а отметки нет, в конец блока EXIF дописывается
// новый первый каталог (IFD0) со старыми записями и отметкой, а заголовок указывает на него: ничего не сдвигается,
// поэтому все ссылки внутри EXIF остаются верными. Если EXIF нет совсем, добавляется минимальный.

/** Ориентация после поворота ещё на 90° по часовой (1–4 — без зеркала и с ним, 5–8 — с поворотом на 90°) */
const CLOCKWISE: Record<number, number> = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 };
const ORIENTATION = 0x0112;
const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");

export function rotateJpegClockwise(jpeg: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a jpeg");
  let pos = 2;
  // сюда вставится новый EXIF, если его нет: после JFIF (APP0), если он стоит первым, иначе сразу после начала файла
  let insertAt = 2;
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) throw new Error("broken jpeg");
    const marker = jpeg[pos + 1];
    if (marker === 0xff) {
      pos++; // байты-заполнители
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // дальше данные изображения
    const length = jpeg.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (marker === 0xe0 && insertAt === pos) insertAt = end;
    if (marker === 0xe1 && jpeg.subarray(pos + 4, pos + 10).equals(EXIF_HEADER)) {
      const tiff = rotateInTiff(Buffer.from(jpeg.subarray(pos + 10, end)));
      return Buffer.concat([jpeg.subarray(0, pos), app1(tiff), jpeg.subarray(end)]);
    }
    pos = end;
  }
  return Buffer.concat([jpeg.subarray(0, insertAt), app1(minimalTiff(CLOCKWISE[1])), jpeg.subarray(insertAt)]);
}

/** Сегмент APP1 с EXIF */
function app1(tiff: Buffer): Buffer {
  const length = 2 + EXIF_HEADER.length + tiff.length;
  if (length > 0xffff) throw new Error("exif too large");
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(length, 2);
  return Buffer.concat([head, EXIF_HEADER, tiff]);
}

/** Блок TIFF внутри EXIF с одной записью — ориентацией */
function minimalTiff(orientation: number): Buffer {
  const t = Buffer.alloc(26);
  t.write("II", 0, "latin1");
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(8, 4); // первый каталог сразу за заголовком
  t.writeUInt16LE(1, 8); // одна запись
  t.writeUInt16LE(ORIENTATION, 10);
  t.writeUInt16LE(3, 12); // SHORT
  t.writeUInt32LE(1, 14);
  t.writeUInt16LE(orientation, 18);
  t.writeUInt32LE(0, 22); // следующего каталога нет
  return t;
}

function rotateInTiff(tiff: Buffer): Buffer {
  const order = tiff.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") throw new Error("broken exif");
  const le = order === "II";
  const r16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const r32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const w16 = (b: Buffer, v: number, o: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b: Buffer, v: number, o: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));

  const ifd0 = r32(tiff, 4);
  const count = r16(tiff, ifd0);
  if (ifd0 + 2 + count * 12 + 4 > tiff.length) throw new Error("broken exif");
  const entries: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const at = ifd0 + 2 + i * 12;
    if (r16(tiff, at) === ORIENTATION) {
      w16(tiff, CLOCKWISE[r16(tiff, at + 8)] ?? CLOCKWISE[1], at + 8);
      return tiff;
    }
    entries.push(tiff.subarray(at, at + 12));
  }

  // отметки нет: новый первый каталог в конце блока, записи по возрастанию тегов
  const orientation = Buffer.alloc(12);
  w16(orientation, ORIENTATION, 0);
  w16(orientation, 3, 2);
  w32(orientation, 1, 4);
  w16(orientation, CLOCKWISE[1], 8);
  const at = entries.findIndex((e) => r16(e, 0) > ORIENTATION);
  entries.splice(at === -1 ? entries.length : at, 0, orientation);

  const pad = tiff.length % 2; // каталог начинается с чётного смещения
  const start = tiff.length + pad;
  const ifd = Buffer.alloc(pad + 2 + entries.length * 12 + 4);
  w16(ifd, entries.length, pad);
  entries.forEach((e, i) => e.copy(ifd, pad + 2 + i * 12));
  w32(ifd, r32(tiff, ifd0 + 2 + count * 12), pad + 2 + entries.length * 12); // ссылка на следующий каталог прежняя
  const out = Buffer.concat([tiff, ifd]);
  w32(out, start, 4);
  return out;
}
