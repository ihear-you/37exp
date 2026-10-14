import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { background } from "@/lib/db";
import { log, mb, since } from "@/lib/log";
import { finalizePhoto } from "@/lib/photos/ingest";
import { MAX_FILE_BYTES } from "@/lib/photos/limits";

// Оригинал для временного кадра, созданного по уменьшенной копии (app/api/rolls/[id]/frames с preview=1).
// Копии кадра заменяются сделанными с оригинала, кадр перестаёт быть временным (lib/photos/ingest.ts: finalizePhoto).
// Ответы те же, что у приёма кадра: { status: "ok" | "exists" } или { error }.

const STATUS = { size: 413, quota: 413, format: 415, storage: 500, roll: 404 } as const;

const json = (body: object, status = 200) => Response.json(body, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const start = Date.now();
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);

  const frameId = (await params).id;
  if (!/^[0-9a-f]{12}$/.test(frameId)) return json({ error: "roll" }, 404);
  const frame = background.findOwnFrame(user.id, frameId);
  if (!frame) return json({ error: "roll" }, 404);
  // повтор после обрыва, а оригинал уже принят
  if (!frame.provisional) return json({ status: "exists" });
  // кадр из загрузки с устройства: заодно отмечаем, что она ещё жива (lib/uploads.ts)
  if (frame.uploadId && !background.touchUpload(user.id, frame.uploadId)) return json({ error: "upload" }, 410);

  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_BYTES + 64 * 1024) return json({ error: "size" }, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "form" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "form" }, 400);
  log("upload", `кадр ${frameId}: принят оригинал «${file.name}» ${mb(file.size)}, чтение ${since(start)} мс`);

  const result = await finalizePhoto(user.id, frameId, Buffer.from(await file.arrayBuffer()));
  log("upload", `кадр ${frameId}: ответ ${result.status === "error" ? `ошибка ${result.error}` : "ok"}, всего ${since(start)} мс`);
  if (result.status === "error") return json({ error: result.error }, STATUS[result.error]);

  revalidatePath("/", "layout");
  return json({ status: "ok" });
}
