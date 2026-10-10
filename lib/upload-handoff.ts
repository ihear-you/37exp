// Кадры, выбранные до формы загрузки (на пустой странице папок, см. EmptyArchive.tsx). Файлы нельзя
// передать через адрес страницы, поэтому они ждут форму в памяти вкладки: форма забирает их при
// открытии (UploadPrototype.tsx). После полной перезагрузки страницы здесь пусто, и форма открывается обычной.

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
