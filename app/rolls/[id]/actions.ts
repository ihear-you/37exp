"use server";

import { revalidatePath } from "next/cache";
import { VISIBILITIES, type Film, type RollEdit } from "@/lib/catalog";
import { requireUser } from "@/lib/auth/session";
import { deleteFrame, getMyFilms, updateRoll } from "@/lib/db";

// Серверные действия страницы плёнки. Вызываются по сети, поэтому и права, и данные проверяются заново.

const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

function valid(e: RollEdit, films: Film[]) {
  return (
    films.some((f) => f.id === e.filmId) &&
    VISIBILITIES.some((v) => v.id === e.visibility) &&
    (e.format === "35" || e.format === "120") &&
    isInt(e.month, 1, 12) &&
    isInt(e.year, 1900, 2200) &&
    (e.iso === null || isInt(e.iso, 1, 100000)) &&
    typeof e.cameraId === "string" &&
    typeof e.description === "string" &&
    e.description.length <= 5000 &&
    (e.title === null || (typeof e.title === "string" && e.title.length <= 200))
  );
}

/** true, если сохранено */
export async function saveRollAction(id: number, edit: RollEdit): Promise<boolean> {
  const user = await requireUser();
  if (!user || !Number.isInteger(id) || !valid(edit, await getMyFilms(user.id))) return false;
  const ok = await updateRoll(user.id, id, { ...edit, title: edit.title?.trim() || null, description: edit.description.trim() });
  // название и счётчики видны в ленте, списке папок и шапке: сбрасываем кэш страниц целиком
  if (ok) revalidatePath("/", "layout");
  return ok;
}

/** true, если кадр убран */
export async function deleteFrameAction(frameId: string): Promise<boolean> {
  const user = await requireUser();
  if (!user || typeof frameId !== "string") return false;
  const ok = await deleteFrame(user.id, frameId);
  if (ok) revalidatePath("/", "layout");
  return ok;
}
