import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { background } from "@/lib/db";
import { ingestPhoto, ingestPreview } from "@/lib/photos/ingest";
import { MAX_FILE_BYTES, MAX_PREVIEW_BYTES } from "@/lib/photos/limits";
import { ensureSweeper } from "@/lib/uploads";
import { log, mb, since } from "@/lib/log";

// Приём одного кадра в плёнку (форма: file — файл, idx — номер кадра, зарезервированный в startUploadAction).
// Кадры идут по одному, чтобы был прогресс по каждому и повтор при сбое. Сама обработка: lib/photos/ingest.ts.
//
// preview=1: вместо оригинала пришла уменьшенная копия (JPEG, её делает браузер). По ней создаётся временный
// кадр, и плёнка видна сразу; оригинал придёт следом в app/api/frames/[id]/original и заменит копию.

const STATUS = { size: 413, quota: 413, format: 415, storage: 500, roll: 404 } as const;

const json = (body: object, status = 200) => Response.json(body, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const start = Date.now();
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);

  const rollId = Number((await params).id);
  if (!Number.isInteger(rollId)) return json({ error: "roll" }, 404);

  // не читаем тело, если оно заведомо больше предела (запас на служебные части формы)
  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_BYTES + 64 * 1024) return json({ error: "size" }, 413);

  // тело целиком принимает nginx и только потом отдаёт сюда, поэтому время чтения здесь маленькое;
  // сколько файл шёл от браузера, видно в журнале nginx (37exp.ru-timing.log)
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    log("upload", `плёнка ${rollId}: форма не прочитана за ${since(start)} мс`);
    return json({ error: "form" }, 400);
  }
  const file = form.get("file");
  const idx = Number(form.get("idx"));
  if (!(file instanceof File) || !Number.isInteger(idx) || idx < 1) return json({ error: "form" }, 400);

  // загрузка целиком или никак (lib/uploads.ts): если её уже отменили (ушли со страницы), кадр не нужен
  const upload = form.get("upload");
  const uploadId = typeof upload === "string" && upload ? upload : undefined;
  if (uploadId) {
    ensureSweeper();
    if (background.touchUpload(user.id, uploadId)?.rollId !== rollId) return json({ error: "upload" }, 410);
  }

  if (form.get("preview") === "1") {
    if (file.size > MAX_PREVIEW_BYTES) return json({ error: "size" }, 413);
    const data = Buffer.from(await file.arrayBuffer());
    // копию отдаём потом как image/jpeg, поэтому принимаем только JPEG
    if (data[0] !== 0xff || data[1] !== 0xd8) return json({ error: "format" }, 415);
    const result = await ingestPreview(user.id, rollId, idx, data, uploadId);
    log("upload", `плёнка ${rollId} №${idx}: копия ${mb(file.size)}, ответ ${result.status === "error" ? `ошибка ${result.error}` : result.status}, всего ${since(start)} мс`);
    if (result.status === "error") return json({ error: result.error }, STATUS[result.error]);
    if (result.status === "exists") {
      // повтор после обрыва: кадр уже создан. Отдаём его, чтобы браузер прислал к нему оригинал (или не слал, если он уже есть)
      const frame = background.findOwnFrameAt(user.id, rollId, idx);
      return frame ? json({ status: "exists", ...frame }) : json({ error: "roll" }, 404);
    }
    revalidatePath("/", "layout");
    return json(result);
  }
  log("upload", `плёнка ${rollId} №${idx}: принят файл «${file.name}» ${mb(file.size)}, чтение ${since(start)} мс`);

  const result = await ingestPhoto(user.id, rollId, idx, Buffer.from(await file.arrayBuffer()), uploadId);
  log("upload", `плёнка ${rollId} №${idx}: ответ ${result.status === "error" ? `ошибка ${result.error}` : result.status}, всего ${since(start)} мс`);
  if (result.status === "error") return json({ error: result.error }, STATUS[result.error]);
  if (result.status === "exists") return json({ status: "exists" });

  revalidatePath("/", "layout");
  return json(result);
}
