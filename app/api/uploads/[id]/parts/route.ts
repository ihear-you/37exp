import { requireUser } from "@/lib/auth/session";
import { background } from "@/lib/db";
import { MAX_FILE_BYTES } from "@/lib/photos/limits";
import { writeUploadPart } from "@/lib/storage";
import { ensureSweeper } from "@/lib/uploads";

// Часть файла (lib/upload-queue.ts шлёт файлы кусочками по 1 МБ, по два сразу): тело — сами байты,
// ?idx — номер кадра в плёнке, ?offset — с какого байта эта часть, ?size — размер файла целиком.
// Части пишутся на свои места (могут прийти не по порядку), повтор безопасен. Кадр собирается
// в app/api/uploads/[id]/frames, когда браузер получил ответы на все части.

/** Одна часть больше не бывает (браузер шлёт по 1 МБ) */
const MAX_PART_BYTES = 2 * 1024 * 1024;

const json = (body: object, status = 200) => Response.json(body, { status });
const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : NaN);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);

  // загрузка целиком или никак (lib/uploads.ts): если её отменили (закрыли вкладку), части не нужны
  const uploadId = (await params).id;
  ensureSweeper();
  if (!background.touchUpload(user.id, uploadId)) return json({ error: "upload" }, 410);

  const query = new URL(request.url).searchParams;
  const idx = int(query.get("idx"));
  const offset = int(query.get("offset"));
  const size = int(query.get("size"));
  if (!(idx >= 1) || !(offset >= 0) || !(size >= 1)) return json({ error: "form" }, 400);
  if (size > MAX_FILE_BYTES) return json({ error: "size" }, 413);
  if (Number(request.headers.get("content-length") || 0) > MAX_PART_BYTES) return json({ error: "form" }, 400);

  const data = new Uint8Array(await request.arrayBuffer());
  if (!data.length || data.length > MAX_PART_BYTES || offset + data.length > size) return json({ error: "form" }, 400);

  try {
    await writeUploadPart(uploadId, idx, offset, data);
  } catch {
    return json({ error: "storage" }, 500);
  }
  return json({ status: "ok" });
}
