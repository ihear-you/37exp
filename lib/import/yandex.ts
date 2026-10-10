import { MAX_FILE_BYTES, MAX_FRAMES_PER_UPLOAD } from "../photos/limits";

// Импорт кадров по публичной ссылке Яндекс Диска. Работает через открытый API публичных ресурсов:
// ни входа в Яндекс, ни ключей не нужно, достаточно самой ссылки.
// Сервер ходит только на адреса Яндекса: ссылка проверяется по списку доменов, а адрес скачивания
// и каждый редирект проверяются заново, чтобы через это поле нельзя было заставить сервер
// обращаться к чужим или внутренним адресам.

const API = "https://cloud-api.yandex.net/v1/disk/public/resources";
const LINK_HOSTS = /^(disk\.yandex\.(ru|com|by|kz|uz|com\.tr)|disk\.360\.yandex\.(ru|com)|yadi\.sk)$/;
const DOWNLOAD_HOSTS = /(^|\.)(yandex\.(ru|net|com|by|kz|uz|com\.tr)|yadi\.sk)$/;
const IMAGE = /\.(jpe?g|png|tiff?|webp|heic|heif)$/i;
const PAGE = 200;

export interface SourceFile {
  name: string;
  /** Путь внутри публичной папки; пусто, если ссылка ведёт на один файл */
  path: string;
  size: number;
  /** Миниатюра с Диска (отдаётся без входа) или null */
  preview: string | null;
}

export interface SourceListing {
  /** Название папки (или файла), по нему форма подсказывает плёнку и дату */
  name: string;
  files: SourceFile[];
  /** Сколько пропущено: не картинки и вложенные папки */
  skipped: number;
  /** Сколько картинок пропущено из-за размера больше предела */
  tooBig: number;
}

/** Код ошибки для показа пользователю */
export class ImportError extends Error {
  constructor(public code: "link" | "notfound" | "empty" | "toomany" | "source" | "size" | "download") {
    super(code);
  }
}

/** Ссылка на Яндекс Диск в каноническом виде или null, если это не она */
export function normalizeYandexUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !LINK_HOSTS.test(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || url.port) return null;
  return `https://${url.hostname.toLowerCase()}${url.pathname}`;
}

interface ApiItem {
  name: string;
  path: string;
  type: "dir" | "file";
  mime_type?: string;
  size?: number;
  preview?: string;
}

interface ApiResource extends ApiItem {
  _embedded?: { items: ApiItem[]; total: number };
}

async function api(path: "" | "/download", params: Record<string, string>): Promise<Response> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new ImportError("notfound");
  if (!res.ok) throw new ImportError("source");
  return res;
}

/** Адрес миниатюры отдаём в браузер только если он яндексовский и https */
function safePreview(url: string | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" && DOWNLOAD_HOSTS.test(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

const isImage = (i: ApiItem) => i.type === "file" && ((i.mime_type ?? "").startsWith("image/") || IMAGE.test(i.name));
const byName = (a: SourceFile, b: SourceFile) => a.name.localeCompare(b.name, "ru", { numeric: true });

/**
 * Картинки по публичной ссылке (папка или один файл), по имени. Вложенные папки не обходятся.
 * preview: какие уменьшенные копии просить у Диска: "tile" — квадратные 300 px для плиток формы,
 * "large" — самые крупные, какие отдаёт Диск (1280 px по длинной стороне), для быстрого показа кадра.
 */
export async function listYandex(publicKey: string, preview: "tile" | "large" = "tile"): Promise<SourceListing> {
  const previewParams = preview === "tile" ? { preview_size: "M", preview_crop: "true" } : { preview_size: "XXXL", preview_crop: "false" };
  const files: SourceFile[] = [];
  let skipped = 0;
  let tooBig = 0;
  let name = "";

  // идём по фактически полученному числу файлов: сервер может отдать на страницу меньше, чем просили
  for (let offset = 0; ; ) {
    const data = (await (await api("", { public_key: publicKey, limit: String(PAGE), offset: String(offset), sort: "name", ...previewParams })).json()) as ApiResource;
    name = data.name;

    const items = data.type === "file" ? [{ ...data, path: "" }] : (data._embedded?.items ?? []);
    for (const i of items) {
      if (!isImage(i)) skipped++;
      else if ((i.size ?? 0) > MAX_FILE_BYTES) tooBig++;
      else files.push({ name: i.name, path: i.path, size: i.size ?? 0, preview: safePreview(i.preview) });
    }
    if (files.length > MAX_FRAMES_PER_UPLOAD) throw new ImportError("toomany");

    offset += items.length;
    if (data.type === "file" || items.length === 0 || offset >= (data._embedded?.total ?? 0)) break;
  }

  if (files.length === 0) throw new ImportError("empty");
  return { name, files: files.sort(byName), skipped, tooBig };
}

const RETRY_DELAYS = [600, 2000]; // всего три попытки

/**
 * Скачивает один файл публичной папки. Размер ограничен, адреса скачивания только яндексовские.
 * Обрыв соединения и временный отказ Яндекса повторяются сами; «файл слишком большой» и
 * «по ссылке ничего нет» повторять бессмысленно.
 */
export async function downloadYandex(publicKey: string, path: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(publicKey, path);
    } catch (e) {
      const final = e instanceof ImportError && (e.code === "size" || e.code === "notfound" || e.code === "link");
      if (final || attempt >= RETRY_DELAYS.length) throw e instanceof ImportError ? e : new ImportError("download");
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

async function downloadOnce(publicKey: string, path: string): Promise<Buffer> {
  const query: Record<string, string> = { public_key: publicKey };
  if (path) query.path = path;
  const { href } = (await (await api("/download", query)).json()) as { href?: string };
  if (!href) throw new ImportError("source");
  return fetchBytes(href, MAX_FILE_BYTES, 180_000);
}

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

/** Уменьшенная копия кадра по адресу из списка. Одна повторная попытка: шаг быстрый, а оригинал всё равно придёт */
export async function fetchYandexPreview(url: string): Promise<Buffer> {
  try {
    return await fetchBytes(url, MAX_PREVIEW_BYTES, 30_000);
  } catch (e) {
    if (e instanceof ImportError && e.code === "size") throw e;
    return fetchBytes(url, MAX_PREVIEW_BYTES, 30_000);
  }
}

/** Скачивает по адресу Яндекса не больше maxBytes; каждый редирект проверяется по списку доменов */
async function fetchBytes(start: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !DOWNLOAD_HOSTS.test(target.hostname.toLowerCase())) throw new ImportError("download");
    const res = await fetch(target, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new ImportError("download");
      url = new URL(next, target).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new ImportError("download");
    if (Number(res.headers.get("content-length") || 0) > maxBytes) throw new ImportError("size");

    // читаем по кускам, чтобы не принять больше предела, даже если размер не объявлен
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > maxBytes) throw new ImportError("size");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new ImportError("download");
}
