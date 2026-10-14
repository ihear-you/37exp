import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { background, getImport } from "@/lib/db";
import { isImportRunning, resumeImport } from "@/lib/import/runner";

// Ход импорта по ссылке: клиент опрашивает этот адрес, пока задание не закончится.
// Заодно подхватывает задание, брошенное перезапуском сервера: если файлы ещё есть в очереди,
// а исполнитель не работает, он запускается заново.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "auth" }, { status: 401 });

  const { id } = await params;
  let job = await getImport(user.id, id);
  if (!job) return Response.json({ error: "notfound" }, { status: 404 });
  // форма открыта: загрузка жива (без опросов уборщик через 3 минуты сочтёт её брошенной, lib/uploads.ts)
  background.touchUpload(user.id, id);

  const pending = (j: typeof job) => j!.items.some((i) => i.status === "queued" || i.status === "preview" || i.status === "working");
  if (pending(job) && !isImportRunning(id)) {
    resumeImport(id);
    job = (await getImport(user.id, id))!;
  }

  const finished = !pending(job);
  // новые кадры должны появляться в ленте, папках и шапке по мере прихода, а не только в конце
  revalidatePath("/", "layout");

  return Response.json({
    rollId: job.rollId,
    finished,
    total: job.items.length,
    /** сколько кадров уже видно в плёнке (по уменьшенной копии или с оригиналом) */
    shown: job.items.filter((i) => i.status === "done" || i.frameId).length,
    /** сколько оригиналов принято */
    done: job.items.filter((i) => i.status === "done").length,
    failed: job.items.filter((i) => i.status === "error").length,
    items: job.items.map((i) => ({ name: i.name, size: i.size, status: i.status, error: i.error, shown: i.status === "done" || !!i.frameId })),
  });
}
