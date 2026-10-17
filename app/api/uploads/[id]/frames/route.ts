import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { background } from "@/lib/db";
import { log, mb, since } from "@/lib/log";
import { ingestPhoto } from "@/lib/photos/ingest";
import { deleteUploadPart, readUploadPart } from "@/lib/storage";

// Файл пришёл целиком (все части, app/api/uploads/[id]/parts): собрать его и сделать кадр.
// ?idx — номер кадра в плёнке (зарезервирован в startUploadAction), ?size — размер файла.
// Ответы: { status: "ok", id, w, h } | { status: "exists" } (кадр уже принят, повтор) | { error }.

const STATUS = { size: 413, quota: 413, format: 415, storage: 500, roll: 404 } as const;

const json = (body: object, status = 200) => Response.json(body, { status });
const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : NaN);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const start = Date.now();
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);

  const uploadId = (await params).id;
  const upload = background.touchUpload(user.id, uploadId);
  if (!upload) return json({ error: "upload" }, 410);

  const query = new URL(request.url).searchParams;
  const idx = int(query.get("idx"));
  const size = int(query.get("size"));
  if (!(idx >= 1) || !(size >= 1)) return json({ error: "form" }, 400);

  const original = await readUploadPart(uploadId, idx, size);
  // частей не хватает (или файл уже собран раньше, а ответ потерялся): браузер решит по коду
  if (!original) {
    const exists = background.findFrameAt(user.id, upload.rollId, idx);
    return exists ? json({ status: "exists" }) : json({ error: "parts" }, 409);
  }
  log("upload", `плёнка ${upload.rollId} №${idx}: собран файл ${mb(size)} за ${since(start)} мс`);

  const result = await ingestPhoto(user.id, upload.rollId, idx, original, uploadId);
  await deleteUploadPart(uploadId, idx).catch(() => {});
  log("upload", `плёнка ${upload.rollId} №${idx}: ответ ${result.status === "error" ? `ошибка ${result.error}` : result.status}, всего ${since(start)} мс`);
  if (result.status === "error") return json({ error: result.error }, STATUS[result.error]);
  if (result.status === "exists") return json({ status: "exists" });

  revalidatePath("/", "layout");
  return json(result);
}
