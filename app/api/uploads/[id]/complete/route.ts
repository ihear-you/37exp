import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { finishUpload } from "@/lib/uploads";

// Форма сообщает, что все кадры загрузки дошли (или окончательно отклонены сервером): кадры остаются (lib/uploads.ts)
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "auth" }, { status: 401 });
  const ok = await finishUpload(user.id, (await params).id);
  revalidatePath("/", "layout");
  return Response.json(ok ? { status: "ok" } : { error: "upload" }, { status: ok ? 200 : 410 });
}
