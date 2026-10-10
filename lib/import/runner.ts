import { background, type ImportItem } from "../db";
import { discardProvisional, finalizePhoto, ingestPhoto, ingestPreview } from "../photos/ingest";
import { USER_QUOTA_BYTES } from "../photos/limits";
import { downloadYandex, fetchYandexPreview, ImportError } from "./yandex";

// Исполнитель импорта. Работает в процессе сервера и продолжает после ответа на запрос.
//
// Два шага, чтобы плёнка появлялась за секунды, а не через минуту:
//   1) быстрые копии: у источника берутся уменьшенные копии всех кадров (маленькие, поэтому сразу
//      по нескольку), по ним создаются временные кадры: плёнку уже можно смотреть;
//   2) оригиналы: по одному скачиваются и обрабатываются, временные копии заменяются настоящими.
// Состояние каждого файла лежит в базе, поэтому после перезапуска сервера задание можно подхватить
// (resumeImport) и ничего не загрузить дважды: номера кадров зарезервированы заранее.

const PREVIEWS_AT_ONCE = 8;

const g = globalThis as typeof globalThis & { __plenkaImports?: Set<string> };
const running = (g.__plenkaImports ??= new Set<string>());

export const isImportRunning = (id: string) => running.has(id);

/** Запускает задание, если оно ещё не идёт. Не ждёт окончания. */
export function runImport(id: string) {
  if (running.has(id)) return;
  running.add(id);
  void work(id)
    .catch(() => {
      // ошибка самого исполнителя: файлы останутся в очереди, задание подхватится при следующем опросе
    })
    .finally(() => running.delete(id));
}

/** После перезапуска сервера: файлы, оставшиеся «в работе», возвращаются в очередь, задание продолжается */
export function resumeImport(id: string) {
  if (running.has(id)) return;
  background.requeueImportItems(id, ["working"]);
  runImport(id);
}

async function work(id: string) {
  const job = background.findImport(id);
  if (!job) return;
  await showPreviews(id, job.userId, job.rollId, job.items);
  await fetchOriginals(id, job.userId, job.rollId, job.sourceUrl);
}

/** Шаг 1. Сбой здесь не страшен: файл остаётся в очереди и на шаге 2 придёт сразу оригиналом */
async function showPreviews(id: string, userId: number, rollId: number, items: ImportItem[]) {
  const todo = items.filter((i) => i.status === "queued" && i.preview && !i.frameId);
  let at = 0;
  const worker = async () => {
    for (let item = todo[at++]; item; item = todo[at++]) {
      try {
        const result = await ingestPreview(userId, rollId, item.idx, await fetchYandexPreview(item.preview!));
        if (result.status === "ok") background.setImportItem(id, item.pos, "preview", null, result.id);
      } catch {
        // без быстрой копии: оригинал придёт на шаге 2
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREVIEWS_AT_ONCE, todo.length) }, worker));
}

type Fetched = { data: Buffer } | { error: string };

/** Шаг 2 */
async function fetchOriginals(id: string, userId: number, rollId: number, sourceUrl: string) {
  // Скачивание и обработка идут внахлёст: пока текущий кадр обрабатывается, следующий уже качается.
  // Качать больше одного оригинала сразу смысла нет (упираемся в скорость канала), а так время кадра
  // равно большему из двух шагов, а не их сумме. В памяти при этом не больше двух файлов.
  const fetchNext = (): { item: ImportItem; fetched: Promise<Fetched> } | null => {
    const item = background.takeImportItem(id);
    if (!item) return null;
    const fetched: Promise<Fetched> =
      background.usedBytes(userId) + item.size > USER_QUOTA_BYTES
        ? Promise.resolve({ error: "quota" })
        : downloadYandex(sourceUrl, item.path).then(
            (data) => ({ data }),
            (e) => ({ error: e instanceof ImportError ? e.code : "download" }),
          );
    return { item, fetched };
  };

  for (let current = fetchNext(); current; ) {
    const { item } = current;
    const got = await current.fetched;
    const next = fetchNext();

    let error: string | null = "error" in got ? got.error : null;
    // кадр, по которому файл уже показан; null, если его нет или он стёрт
    let frameId = item.frameId;
    try {
      if ("data" in got) {
        if (frameId) {
          const result = await finalizePhoto(userId, frameId, got.data);
          if (result.status === "error") {
            error = result.error;
            if (result.removed) frameId = null;
          }
        } else {
          const result = await ingestPhoto(userId, rollId, item.idx, got.data);
          if (result.status === "error") error = result.error;
        }
      } else if (frameId && (got.error === "size" || got.error === "quota")) {
        // оригинал не принять совсем (слишком большой, нет места): кадр без оригинала в архиве не оставляем
        if (await discardProvisional(userId, frameId)) frameId = null;
      }
    } catch {
      error = "storage";
    }
    background.setImportItem(id, item.pos, error ? "error" : "done", error, frameId);
    current = next;
  }
}
