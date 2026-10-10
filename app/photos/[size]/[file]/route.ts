import { canView } from "@/lib/access";
import { getViewer } from "@/lib/auth/session";
import { readShareKeys } from "@/lib/auth/shares";
import { getFrameAccess } from "@/lib/db";
import { readPhoto } from "@/lib/storage";

// Выдача картинок кадров: /photos/f/<id>.jpg (для ленты) и /photos/l/<id>.jpg (на весь экран).
// Файлы лежат вне public/ и отдаются только тем, кто вправе видеть плёнку (lib/access.ts).
// Без права, как и для несуществующего кадра, ответ 404.
export async function GET(_request: Request, { params }: { params: Promise<{ size: string; file: string }> }) {
  const { size, file } = await params;
  const id = /^([A-Za-z0-9-]+)\.jpg$/.exec(file)?.[1];
  if ((size !== "f" && size !== "l") || !id) return new Response(null, { status: 404 });

  const access = await getFrameAccess(id);
  if (!access) return new Response(null, { status: 404 });
  const viewer = await getViewer();
  if (!canView(access, viewer?.id ?? null, await readShareKeys())) return new Response(null, { status: 404 });

  const data = await readPhoto(size === "f" ? "feed" : "full", id);
  if (!data) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      // содержимое кадра не меняется; закрытые плёнки не должны оседать в общих кэшах.
      // Временная копия (импорт, до прихода оригинала) скоро заменится: её не кэшируем
      "Cache-Control": access.provisional ? "private, no-store" : `${access.visibility === "public" ? "public" : "private"}, max-age=3600`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
