import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { ingestPhoto } from "@/lib/photos/ingest";
import { MAX_FILE_BYTES } from "@/lib/photos/limits";
import { log, mb, since } from "@/lib/log";

// Приём одного кадра в плёнку (форма: file — файл, idx — номер кадра, зарезервированный в startUploadAction).
// Кадры идут по одному, чтобы был прогресс по каждому и повтор при сбое. Сама обработка: lib/photos/ingest.ts.

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
  log("upload", `плёнка ${rollId} №${idx}: принят файл «${file.name}» ${mb(file.size)}, чтение ${since(start)} мс`);

  const result = await ingestPhoto(user.id, rollId, idx, Buffer.from(await file.arrayBuffer()));
  log("upload", `плёнка ${rollId} №${idx}: ответ ${result.status === "error" ? `ошибка ${result.error}` : result.status}, всего ${since(start)} мс`);
  if (result.status === "error") return json({ error: result.error }, STATUS[result.error]);
  if (result.status === "exists") return json({ status: "exists" });

  revalidatePath("/", "layout");
  return json(result);
}
