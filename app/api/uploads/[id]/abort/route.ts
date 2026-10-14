import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { abandonUpload } from "@/lib/uploads";

// Со страницы загрузки ушли до конца: кадры этой загрузки стираются, плёнка, созданная ею, тоже (lib/uploads.ts).
// Форма шлёт сюда navigator.sendBeacon при закрытии вкладки, поэтому ответ никто не читает
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return new Response(null, { status: 401 });
  await abandonUpload(user.id, (await params).id, "ушли со страницы");
  revalidatePath("/", "layout");
  return new Response(null, { status: 204 });
}
