import { canView } from "@/lib/access";
import { getViewer } from "@/lib/auth/session";
import { readShareKeys } from "@/lib/auth/shares";
import { rollTitle } from "@/lib/catalog";
import { getFrameOriginal, getMyFilms, getRollForViewer } from "@/lib/db";
import { openOriginal } from "@/lib/storage";

// Скачать оригинал кадра: /photos/o/<id>. Файл как загружен, байт в байт. Скачать может тот, кто вправе видеть плёнку
// (lib/access.ts), как и картинки в /photos/f|l; без права, как и для несуществующего кадра, ответ 404.
// Имя файла — название плёнки и номер кадра, например «Kodak Gold 200 · июль 2026 — 05.jpg».

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  avif: "image/avif",
};

/** Символы, которые нельзя в имени файла на Windows и macOS */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const frame = await getFrameOriginal(id);
  if (!frame) return new Response(null, { status: 404 });
  const viewer = await getViewer();
  const keys = await readShareKeys();
  if (!canView(frame, viewer?.id ?? null, keys)) return new Response(null, { status: 404 });

  const file = await openOriginal(frame.ownerId, id);
  if (!file) return new Response(null, { status: 404 });

  const page = await getRollForViewer(frame.rollId, viewer?.id ?? null, keys);
  const films = page ? page.films : await getMyFilms(frame.ownerId);
  const title = page ? rollTitle(page.roll, films) : "37exp";
  const name = `${safeName(title)} — ${String(frame.idx).padStart(2, "0")}.${file.ext}`;

  return new Response(file.stream, {
    headers: {
      "Content-Type": TYPES[file.ext] ?? "application/octet-stream",
      "Content-Length": String(file.size),
      // ascii-имя для старых браузеров и настоящее (UTF-8) для остальных
      "Content-Disposition": `attachment; filename="37exp-${frame.rollId}-${String(frame.idx).padStart(2, "0")}.${file.ext}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
