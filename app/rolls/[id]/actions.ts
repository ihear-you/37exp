"use server";

import { revalidatePath } from "next/cache";
import { VISIBILITIES, type Film, type RollEdit, type Visibility } from "@/lib/catalog";
import { requireUser } from "@/lib/auth/session";
import { deleteFrame, deleteRoll, getMyFilms, setRollVisibility, updateRoll } from "@/lib/db";
import { rotatePhoto, type RotateError } from "@/lib/photos/rotate";

// Серверные действия страницы плёнки. Вызываются по сети, поэтому и права, и данные проверяются заново.

const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

function valid(e: RollEdit, films: Film[]) {
  return (
    films.some((f) => f.id === e.filmId) &&
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

/** Кто видит плёнку. true, если сохранено */
export async function setRollVisibilityAction(id: number, visibility: Visibility): Promise<boolean> {
  const user = await requireUser();
  if (!user || !Number.isInteger(id) || !VISIBILITIES.some((v) => v.id === visibility)) return false;
  const ok = await setRollVisibility(user.id, id, visibility);
  // плёнка появляется или пропадает на странице автора и у тех, кто пришёл по ссылке
  if (ok) revalidatePath("/", "layout");
  return ok;
}

/** Удаляет плёнку со всеми кадрами и файлами. Необратимо. true, если удалена */
export async function deleteRollAction(id: number): Promise<boolean> {
  const user = await requireUser();
  if (!user || !Number.isInteger(id)) return false;
  const ok = await deleteRoll(user.id, id);
  if (ok) revalidatePath("/", "layout");
  return ok;
}

/** true, если кадр убран */
/**
 * Повернуть кадр на 90° по часовой (только свой, только с оригиналом). Поворачивается сам оригинал (lib/photos/rotate.ts).
 * error — готовый текст для показа
 */
export async function rotateFrameAction(frameId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!user || typeof frameId !== "string") return { ok: false, error: "Войдите, чтобы поворачивать кадры" };
  const result = await rotatePhoto(user.id, frameId);
  if (result.status === "error") return { ok: false, error: ROTATE_ERRORS[result.error] };
  revalidatePath("/", "layout");
  return { ok: true };
}

const ROTATE_ERRORS: Record<RotateError, string> = {
  format: "Этот формат нельзя повернуть",
  roll: "Кадр не найден",
  storage: "Не удалось сохранить, попробуйте ещё раз",
  busy: "Кадр уже поворачивается",
};

export async function deleteFrameAction(frameId: string): Promise<boolean> {
  const user = await requireUser();
  if (!user || typeof frameId !== "string") return false;
  const ok = await deleteFrame(user.id, frameId);
  if (ok) revalidatePath("/", "layout");
  return ok;
}
