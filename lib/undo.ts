import { useSyncExternalStore } from "react";

// «Кадр удалён · Отменить»: кадр удаляется сразу, без подтверждения, а несколько секунд его можно вернуть.
// Удалённый кадр в базе только помечается (deleted_at), поэтому вернуть — значит снять пометку (restoreFramesAction).
// Если удалить несколько кадров подряд, плашка одна («Удалено кадров: 3») и возвращает все. Показывает её
// UploadIndicator.tsx, в том же углу, что и ход загрузки.

/** Сколько секунд можно отменить удаление */
export const UNDO_MS = 7000;

export interface Undo {
  ids: string[];
  /** Растёт с каждым удалением: по нему плашка заново отсчитывает время */
  at: number;
}

let undo: Undo | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Undo | null) {
  undo = next;
  listeners.forEach((l) => l());
}

/** Кадр удалён: показать плашку (или добавить к уже показанной) и отсчитывать время заново */
export function noteDeleted(id: string) {
  clearTimeout(timer);
  set({ ids: [...(undo?.ids ?? []), id], at: Date.now() });
  timer = setTimeout(() => set(null), UNDO_MS);
}

/** Нажали «Отменить» или закрыли плашку: забрать удалённые кадры, плашка исчезает */
export function takeUndo(): string[] {
  clearTimeout(timer);
  const ids = undo?.ids ?? [];
  set(null);
  return ids;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useUndo(): Undo | null {
  return useSyncExternalStore(subscribe, () => undo, () => null);
}
