import { useSyncExternalStore } from "react";
import { retryImportAction } from "@/app/upload/actions";

// Загрузчик на весь сайт: загрузка, начатая в форме (UploadPrototype.tsx), живёт здесь, а не в форме,
// поэтому из формы можно уйти на любую страницу сайта — кадры продолжат уходить, ход виден в углу
// (UploadIndicator.tsx). Оригиналы с устройства отправляет браузер по три сразу; импорт с Диска качает сервер,
// а загрузчик спрашивает, как он идёт.
//
// Загрузка целиком или никак (lib/uploads.ts на сервере): если закрыть вкладку или обновить страницу до конца,
// браузер переспросит, а при согласии загрузчик сообщит серверу (sendBeacon), и кадры этой загрузки сотрутся.
// Всё живёт в памяти вкладки: после полной перезагрузки страницы здесь пусто.

export type ItemStatus = "queued" | "uploading" | "done" | "error";

export interface QueueItem {
  id: number;
  name: string;
  size: number;
  /** Превью в форме: у кадров с устройства сам файл, у кадров по ссылке миниатюра с Диска (её может не быть) */
  url?: string;
  /** Есть только у кадров с устройства: по ссылке файлы скачивает сервер */
  file?: File;
  /** Номер кадра в плёнке, зарезервированный при старте */
  idx: number;
  status: ItemStatus;
  progress: number;
  error?: string;
  /** Сервер отклонил файл окончательно (не картинка, слишком большой, нет места): повтор не поможет */
  fatal?: boolean;
  /** Импорт: кадр уже виден в плёнке по уменьшенной копии с Диска */
  shown?: boolean;
}

export interface UploadJob {
  /** Номер загрузки на сервере; у импорта совпадает с номером задания */
  id: string;
  kind: "files" | "import";
  rollId: number;
  title: string;
  /** Плёнку создала эта загрузка (новая плёнка видна только автору) */
  created: boolean;
  items: QueueItem[];
  startedAt: number;
  /** Каждый кадр дошёл или отклонён окончательно; сервер знает, что загрузка закончена */
  finished: boolean;
}

/** Что написать, если сервер отказал (коды из app/api/rolls/[id]/frames и импорта) */
export const UPLOAD_ERRORS: Record<string, string> = {
  auth: "Войдите заново и повторите",
  size: "Файл слишком большой",
  quota: "Не хватает места в вашем архиве",
  format: "Не удалось прочитать картинку: формат не поддерживается",
  roll: "Плёнка не найдена",
  storage: "Сервер не смог сохранить файл",
  form: "Сервер не принял файл",
  download: "Не удалось скачать файл с Яндекс Диска",
  upload: "Загрузка отменена",
};
/** Коды ошибок, при которых повтор бессмыслен */
const FATAL = ["format", "size", "quota"];
const PARALLEL = 3;
/** Сколько висит в углу сообщение «Готово», прежде чем исчезнуть само */
const DONE_VISIBLE_MS = 20_000;

// ── журнал в консоли браузера (DevTools → Console, строки «[загрузка]»); серверная половина — lib/log.ts ──
export const log = (...args: unknown[]) => console.info("%c[загрузка]", "color:#c2572e;font-weight:bold", ...args);
export const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`;
const rate = (bytes: number, ms: number) => `${((bytes / 1048576) * (1000 / Math.max(ms, 1))).toFixed(2)} МБ/с`;

// ── хранилище ──

let jobs: UploadJob[] = [];
const NONE: UploadJob[] = [];
const listeners = new Set<() => void>();

function setJobs(next: UploadJob[]) {
  jobs = next;
  listeners.forEach((l) => l());
}
function patchJob(jobId: string, patch: (job: UploadJob) => UploadJob) {
  setJobs(jobs.map((j) => (j.id === jobId ? patch(j) : j)));
}
function patchItem(jobId: string, itemId: number, p: Partial<QueueItem>) {
  patchJob(jobId, (j) => ({ ...j, items: j.items.map((i) => (i.id === itemId ? { ...i, ...p } : i)) }));
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Все загрузки этой вкладки (на сервере и при первой отрисовке — пусто) */
export function useUploadJobs(): UploadJob[] {
  return useSyncExternalStore(subscribe, () => jobs, () => NONE);
}

// Загрузка, которую сейчас показывает открытая форма: индикатор в углу её не дублирует
let shownInForm: string | null = null;
export function setShownInForm(jobId: string | null) {
  shownInForm = jobId;
  listeners.forEach((l) => l());
}
/** Номер загрузки, которую показывает форма (на сервере — null) */
export function useShownInForm(): string | null {
  return useSyncExternalStore(subscribe, () => shownInForm, () => null);
}

const isSettled = (items: QueueItem[]) => items.length > 0 && items.every((i) => i.status === "done" || (i.status === "error" && i.fatal));
const isActive = (j: UploadJob) => !j.finished;

// ── запуск ──

export function startFilesJob(job: Omit<UploadJob, "kind" | "startedAt" | "finished">) {
  setJobs([...jobs, { ...job, kind: "files", startedAt: performance.now(), finished: false }]);
  guardLeaving();
  pump();
}

export function startImportJob(job: Omit<UploadJob, "kind" | "startedAt" | "finished">) {
  setJobs([...jobs, { ...job, kind: "import", startedAt: performance.now(), finished: false }]);
  guardLeaving();
  poll(job.id);
}

/** Убрать законченную загрузку из угла. Пока её показывает открытая форма, она остаётся (форме нужны её кадры) */
export function dismissJob(jobId: string) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job?.finished) return;
  if (shownInForm === jobId) {
    setTimeout(() => dismissJob(jobId), DONE_VISIBLE_MS);
    return;
  }
  setJobs(jobs.filter((j) => j.id !== jobId));
}

/** Повтор: одного кадра (itemId) или всех сбойных. Импорт повторяет сервер, и сразу все сбойные файлы */
export function retryJob(jobId: string, itemId?: number) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;
  const again = (i: QueueItem) => i.status === "error" && !i.fatal && (itemId === undefined || job.kind === "import" || i.id === itemId);
  log(`повтор: «${job.title}»${itemId !== undefined && job.kind === "files" ? `, кадр ${job.items.find((i) => i.id === itemId)?.name}` : ", все сбойные"}`);
  patchJob(jobId, (j) => ({ ...j, items: j.items.map((i) => (again(i) ? { ...i, status: "queued", progress: 0, error: undefined } : i)) }));
  if (job.kind === "files") return pump();
  void retryImportAction(jobId).then(() => poll(jobId));
}

// ── с устройства: оригиналы по три сразу, каждый своим запросом с прогрессом ──

const requests = new Map<string, XMLHttpRequest>();
const key = (jobId: string, itemId: number) => `${jobId}:${itemId}`;

function pump() {
  let free = PARALLEL - requests.size;
  for (const job of jobs) {
    if (job.kind !== "files" || job.finished) continue;
    for (const item of job.items) {
      if (free <= 0) return;
      if (item.status === "queued" && !requests.has(key(job.id, item.id))) {
        free--;
        send(job, item);
      }
    }
  }
}

function send(job: UploadJob, item: QueueItem) {
  const k = key(job.id, item.id);
  const xhr = new XMLHttpRequest();
  requests.set(k, xhr);
  patchItem(job.id, item.id, { status: "uploading", progress: 0, error: undefined });
  const t0 = performance.now();
  let sentAt = 0;
  log(`→ №${item.idx} «${item.name}» ${mb(item.size)}: отправка`);

  const finish = (p: Partial<QueueItem>) => {
    requests.delete(k);
    patchItem(job.id, item.id, p);
    settle(job.id);
    pump();
  };

  const body = new FormData();
  body.append("file", item.file!);
  body.append("idx", String(item.idx));
  body.append("upload", job.id);
  xhr.open("POST", `/api/rolls/${job.rollId}/frames`);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) patchItem(job.id, item.id, { progress: Math.min(99, (e.loaded / e.total) * 100) });
  };
  // файл ушёл целиком: дальше ждём, пока сервер его обработает
  xhr.upload.onload = () => {
    sentAt = performance.now();
    const ms = Math.round(sentAt - t0);
    log(`  №${item.idx}: передан за ${ms} мс (${rate(item.size, ms)}), ждём сервер`);
  };
  xhr.onload = () => {
    const total = Math.round(performance.now() - t0);
    const server = sentAt ? Math.round(performance.now() - sentAt) : null;
    log(`← №${item.idx}: ответ ${xhr.status} за ${total} мс${server !== null ? ` (из них ждали сервер ${server} мс)` : ""}`, xhr.status === 200 ? "" : xhr.responseText);
    if (xhr.status === 200) return finish({ status: "done", progress: 100 });
    let code = "";
    try {
      code = JSON.parse(xhr.responseText).error;
    } catch {
      // ответ не JSON
    }
    finish({ status: "error", progress: 0, error: UPLOAD_ERRORS[code] ?? `Ошибка сервера (${xhr.status})`, fatal: FATAL.includes(code) });
  };
  xhr.onerror = () => {
    log(`✕ №${item.idx}: обрыв связи через ${Math.round(performance.now() - t0)} мс${sentAt ? " (файл уже был передан)" : ""}`);
    finish({ status: "error", progress: 0, error: "Нет связи с сервером" });
  };
  xhr.send(body);
}

// ── импорт с Диска: качает сервер, загрузчик раз в полторы секунды спрашивает ход ──
// Опросы заодно говорят серверу, что вкладка открыта: без них через 3 минуты импорт считается брошенным

const polls = new Map<string, ReturnType<typeof setInterval>>();

interface ImportState {
  finished: boolean;
  items: { name: string; size: number; status: "queued" | "preview" | "working" | "done" | "error"; error: string | null; shown: boolean }[];
}

function poll(jobId: string) {
  if (polls.has(jobId)) return;
  const seen = new Map<string, string>();
  const tick = async () => {
    try {
      const r = await fetch(`/api/imports/${jobId}`, { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as ImportState;
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return stop();

      const changed = data.items.filter((i) => seen.get(i.name) !== i.status);
      if (changed.length) {
        const count = (s: string) => data.items.filter((i) => i.status === s).length;
        log(
          `импорт: в плёнке ${data.items.filter((i) => i.shown).length}, оригиналов ${count("done")}, качается ${count("working")}, ошибок ${count("error")} из ${data.items.length}`,
          changed.map((i) => `${i.name}: ${seen.get(i.name) ?? "—"} → ${i.status}${i.error ? ` (${i.error})` : ""}`),
        );
        changed.forEach((i) => seen.set(i.name, i.status));
      }
      patchJob(jobId, (j) => ({
        ...j,
        // миниатюры пришли при поиске по ссылке: сохраняем их за теми же файлами
        items: data.items.map((i, n) => ({
          id: -(n + 1),
          name: i.name,
          size: i.size,
          url: j.items[n]?.name === i.name ? j.items[n].url : undefined,
          idx: 0,
          // preview: кадр уже в плёнке по копии, ждёт оригинал; working: оригинал качается
          status: i.status === "working" || i.status === "preview" ? "uploading" : i.status,
          progress: i.status === "done" ? 100 : i.status === "working" ? 75 : i.status === "preview" ? 50 : 0,
          shown: i.shown,
          error: i.error ? (UPLOAD_ERRORS[i.error] ?? "Не удалось загрузить") : undefined,
          fatal: !!i.error && FATAL.includes(i.error),
        })),
      }));
      // сервер больше ничего не делает: всё дошло, или остались сбойные файлы (их повторяют кнопкой)
      if (data.finished) {
        stop();
        settle(jobId);
      }
    } catch {
      // нет связи: спросим на следующем шаге
    }
  };
  const stop = () => {
    clearInterval(polls.get(jobId));
    polls.delete(jobId);
  };
  polls.set(jobId, setInterval(tick, 1500));
  void tick();
}

// ── конец загрузки ──

function settle(jobId: string) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || job.finished || !isSettled(job.items)) return;
  const done = job.items.filter((i) => i.status === "done").length;
  log(`всё загружено: «${job.title}», ${done} из ${job.items.length} кадров за ${Math.round((performance.now() - job.startedAt) / 1000)} с`);
  patchJob(jobId, (j) => ({ ...j, finished: true }));
  // сервер снимает с кадров отметку «незаконченная загрузка»: теперь они остаются, даже если закрыть вкладку
  void fetch(`/api/uploads/${jobId}/complete`, { method: "POST", keepalive: true })
    .then((r) => log(`загрузка ${jobId} закончена: ответ ${r.status}`))
    .catch(() => log(`загрузка ${jobId}: не удалось сообщить о конце, сервер разберётся сам`));
  setTimeout(() => dismissJob(jobId), DONE_VISIBLE_MS);
}

// ── закрытие вкладки до конца: переспросить, а при согласии отменить незаконченное ──

let guarded = false;

function guardLeaving() {
  if (guarded || typeof window === "undefined") return;
  guarded = true;
  window.addEventListener("beforeunload", (e) => {
    if (!jobs.some(isActive)) return;
    e.preventDefault();
    e.returnValue = "";
  });
  window.addEventListener("pagehide", () => {
    const active = jobs.filter(isActive);
    if (!active.length) return;
    requests.forEach((xhr) => xhr.abort());
    requests.clear();
    // sendBeacon доходит и из закрывающейся вкладки
    for (const job of active) navigator.sendBeacon(`/api/uploads/${job.id}/abort`);
    log(`вкладку закрыли: незаконченные загрузки отменены (${active.length}), их кадры будут стёрты`);
    setJobs(jobs.filter((j) => !isActive(j)));
  });
}
