import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { addFrame, getUsedBytes } from "@/lib/db";
import { MAX_FILE_BYTES, USER_QUOTA_BYTES } from "@/lib/photos/limits";
import { processPhoto } from "@/lib/photos/process";
import { deletePhoto, savePhoto } from "@/lib/storage";

// Приём одного кадра в плёнку (форма: file — файл, idx — номер кадра, зарезервированный в startUploadAction).
// Сохраняет оригинал, копии для ленты и для просмотра на весь экран, считает цвет и яркость.
// Кадры идут по одному, чтобы был прогресс по каждому и повтор при сбое.

const EXT: Record<string, string> = { jpeg: "jpg", png: "png", tiff: "tif", webp: "webp", heif: "heic", gif: "gif", avif: "avif" };

const json = (body: object, status = 200) => Response.json(body, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);

  const rollId = Number((await params).id);
  if (!Number.isInteger(rollId)) return json({ error: "roll" }, 404);

  // не читаем тело, если оно заведомо больше предела (запас на служебные части формы)
  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_BYTES + 64 * 1024) return json({ error: "size" }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "form" }, 400);
  }
  const file = form.get("file");
  const idx = Number(form.get("idx"));
  if (!(file instanceof File) || !Number.isInteger(idx) || idx < 1) return json({ error: "form" }, 400);
  if (file.size > MAX_FILE_BYTES) return json({ error: "size" }, 413);
  if ((await getUsedBytes(user.id)) + file.size > USER_QUOTA_BYTES) return json({ error: "quota" }, 413);

  const original = Buffer.from(await file.arrayBuffer());
  let photo;
  try {
    photo = await processPhoto(original);
  } catch {
    return json({ error: "format" }, 415);
  }

  const id = randomBytes(6).toString("hex");
  const ext = EXT[photo.format] ?? "img";
  try {
    await savePhoto(user.id, id, { original: { data: original, ext }, feed: photo.feed, full: photo.full });
  } catch {
    return json({ error: "storage" }, 500);
  }

  const { w, h, hue, sat, light, color } = photo;
  const result = await addFrame(user.id, rollId, { id, idx, w, h, hue, sat, light, color, bytes: file.size });
  if (result !== "ok") {
    await deletePhoto(user.id, id, ext);
    // «exists»: этот кадр уже принят раньше (повторная отправка после обрыва), считаем успехом
    return result === "exists" ? json({ status: "exists" }) : json({ error: "roll" }, 404);
  }

  revalidatePath("/", "layout");
  return json({ status: "ok", id, w, h });
}
