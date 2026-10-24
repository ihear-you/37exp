// Выбор кадров (две плитки, UploadSources.tsx) и сама загрузка (UploadFlow.tsx) живут на разных страницах:
// плитки стоят и на пустой странице папок, и на /upload. Файлы нельзя передать через адрес страницы, поэтому
// выбранное ждёт страницу загрузки в памяти вкладки: она забирает его при открытии. После полной перезагрузки
// страницы здесь пусто, и /upload просто показывает плитки.

/** Что нашлось по ссылке на Яндекс Диск (ответ previewImportAction) */
export interface LinkListing {
  name: string;
  files: { name: string; size: number; preview: string | null }[];
  skipped: number;
  tooBig: number;
}

export type UploadHandoff =
  | { kind: "files"; files: File[]; folder: string | null }
  | { kind: "link"; url: string; listing: LinkListing };

const IMAGE = /\.(jpe?g|png|tiff?|webp|heic)$/i;
export const isImageFile = (f: File) => f.type.startsWith("image/") || IMAGE.test(f.name);

let pending: UploadHandoff | null = null;

export function handOffUpload(handoff: UploadHandoff) {
  pending = handoff;
}

/** Забирает ожидающие кадры: второй вызов вернёт null */
export function takeUploadHandoff(): UploadHandoff | null {
  const handoff = pending;
  pending = null;
  return handoff;
}

/** Файлы из перетаскивания: обходит вложенные папки; если бросили одну папку, отдаёт её название */
export async function collectDropped(dt: DataTransfer): Promise<{ files: File[]; folder: string | null }> {
  type Entry = FileSystemEntry | null;
  const entries = [...dt.items].filter((i) => i.kind === "file").map((i): Entry => i.webkitGetAsEntry?.() ?? null);
  if (!entries.length || entries.some((e) => !e)) return { files: [...dt.files], folder: null };

  const files: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      files.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
      return;
    }
    const reader = (e as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const e of entries) await walk(e!);
  const folder = entries.length === 1 && entries[0]!.isDirectory ? entries[0]!.name : null;
  return { files, folder };
}
