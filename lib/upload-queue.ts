import { useSyncExternalStore } from "react";
import { retryImportAction } from "@/app/upload/actions";

// Загрузчик на весь сайт: загрузка, начатая на странице загрузки (UploadFlow.tsx), живёт здесь, а не в форме,
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

/** Что написать, если сервер отказал (коды из app/api/uploads/[id]/parts и /frames и импорта) */
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
/**
 * Как часто показывать прогресс отправки. Браузер сообщает о нём десятки раз в секунду, а каждое обновление
 * хранилища React рисует срочно и при этом бросает фоновую работу — переход на другую страницу. На медленном
 * канале файл идёт по минуте, и без этой паузы переходы по сайту во время загрузки не случались вовсе
 */
const PROGRESS_EVERY_MS = 500;

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

// прогресс копится здесь и попадает в хранилище не чаще раза в PROGRESS_EVERY_MS
const pendingProgress = new Map<string, Map<number, number>>();
let progressTimer: ReturnType<typeof setTimeout> | null = null;

function setProgress(jobId: string, itemId: number, progress: number) {
  const job = pendingProgress.get(jobId) ?? new Map<number, number>();
  job.set(itemId, progress);
  pendingProgress.set(jobId, job);
  progressTimer ??= setTimeout(flushProgress, PROGRESS_EVERY_MS);
}

function flushProgress() {
  progressTimer = null;
  if (!pendingProgress.size) return;
  const pending = new Map(pendingProgress);
  pendingProgress.clear();
  setJobs(
    jobs.map((j) => {
      const p = pending.get(j.id);
      // кадр, который за это время уже дошёл или упал, свой прогресс не получает
      return p ? { ...j, items: j.items.map((i) => (p.has(i.id) && i.status === "uploading" ? { ...i, progress: p.get(i.id)! } : i)) } : j;
    }),
  );
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

/** Плёнку переименовали в карточке «Что это за плёнка?»: окно загрузки показывает новое название */
export function renameJob(jobId: string, title: string) {
  patchJob(jobId, (j) => ({ ...j, title }));
}

/**
 * Уходим со страницы загрузки: если загрузка уже закончилась и всё дошло, в углу её не показываем — человек видел
 * итог на странице. Идущую или со сбойными файлами оставляем: окно в углу нужно, чтобы следить и повторить
 */
export function releaseFromForm(jobId: string) {
  if (shownInForm === jobId) shownInForm = null;
  const job = jobs.find((j) => j.id === jobId);
  if (job?.finished && job.items.every((i) => i.status === "done")) dismissJob(jobId);
  else listeners.forEach((l) => l());
}

/**
 * Убрать законченную загрузку из угла (крестик). Сама она не исчезает: в окне видно, что не загрузилось.
 * Миниатюры файлов с устройства форма отдаёт загрузчику при старте, здесь они и освобождаются
 */
export function dismissJob(jobId: string) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job?.finished || shownInForm === jobId) return;
  job.items.forEach((i) => i.url?.startsWith("blob:") && URL.revokeObjectURL(i.url));
  setJobs(jobs.filter((j) => j.id !== jobId));
}

/**
 * Отменить загрузку целиком («Выбрать другие фото»): запросы этой загрузки обрываются, сервер стирает её кадры
 * и созданную ею плёнку (как при закрытии вкладки), из окна в углу она пропадает
 */
export function cancelJob(jobId: string) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;
  for (const [k, c] of controllers) {
    if (k.startsWith(`${jobId}:`)) {
      c.abort();
      controllers.delete(k);
    }
  }
  for (const k of [...fileStates.keys()]) if (k.startsWith(`${jobId}:`)) fileStates.delete(k);
  clearInterval(polls.get(jobId));
  polls.delete(jobId);
  job.items.forEach((i) => i.url?.startsWith("blob:") && URL.revokeObjectURL(i.url));
  setJobs(jobs.filter((j) => j.id !== jobId));
  if (!job.finished) void fetch(`/api/uploads/${jobId}/abort`, { method: "POST", keepalive: true }).catch(() => {});
  log(`загрузка «${job.title}» отменена: выбрали другие фото`);
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

// ── с устройства: файлы кусочками по 1 МБ, в пути не больше двух кусочков на всю вкладку ──
// Браузер шлёт к сайту всё по одному соединению. Целые файлы забивали его очередь мегабайтами, и переход
// на другую страницу ждал за ними до 15–20 секунд на медленном канале. Кусочками в очереди не больше 2 МБ:
// переход ждёт около секунды, а скорость та же (замер на канале 1 МБ/с). Два кусочка в пути — чтобы канал
// не простаивал, пока сервер отвечает на один. Кусочек, который не ушёл, повторяется сам; повтор кадра
// продолжает с недошедших кусочков. Файл собирает сервер (app/api/uploads/[id]/parts и /frames).

const PART_BYTES = 1024 * 1024;
const PARTS_IN_FLIGHT = 2;
/** Паузы перед повтором кусочка или сборки; после последней кадр помечается сбойным (кнопка «Повторить») */
const RETRY_DELAYS = [1000, 3000, 8000];

/** Как идёт файл: какие кусочки дошли и какие в пути */
interface FileState {
  parts: number;
  acked: Set<number>;
  sending: Set<number>;
  finishing: boolean;
  failures: number;
  /** раньше этого времени повтор не начинать */
  waitUntil: number;
  startedAt: number;
  sentAt: number;
}

const fileStates = new Map<string, FileState>();
/** Запросы в пути (кусочки и сборка): их обрывают при закрытии вкладки */
const controllers = new Map<string, AbortController>();
let partsInFlight = 0;
const key = (jobId: string, itemId: number) => `${jobId}:${itemId}`;

function pump() {
  const now = Date.now();
  for (const job of jobs) {
    if (job.kind !== "files" || job.finished) continue;
    for (const item of job.items) {
      if (partsInFlight >= PARTS_IN_FLIGHT) return;
      if (item.status !== "queued" && item.status !== "uploading") continue;
      const k = key(job.id, item.id);
      let st = fileStates.get(k);
      if (item.status === "queued") {
        // новый файл или повтор сбойного: недошедшие кусочки отправятся заново, дошедшие — нет
        st ??= { parts: Math.max(1, Math.ceil(item.size / PART_BYTES)), acked: new Set(), sending: new Set(), finishing: false, failures: 0, waitUntil: 0, startedAt: performance.now(), sentAt: 0 };
        st.failures = 0;
        st.waitUntil = 0;
        fileStates.set(k, st);
        patchItem(job.id, item.id, { status: "uploading", error: undefined });
        log(`→ №${item.idx} «${item.name}» ${mb(item.size)}: отправка${st.acked.size ? `, осталось кусочков ${st.parts - st.acked.size} из ${st.parts}` : ` (${st.parts} кусочков)`}`);
      }
      if (!st || st.waitUntil > now) continue;
      if (st.acked.size === st.parts) {
        if (!st.finishing) finish(job, item, st);
        continue;
      }
      for (let part = 0; part < st.parts && partsInFlight < PARTS_IN_FLIGHT; part++) {
        if (!st.acked.has(part) && !st.sending.has(part)) sendPart(job, item, st, part);
      }
    }
  }
}

/** Сбой кусочка или сборки: подождать и повторить, а после нескольких неудач отдать кадр на кнопку «Повторить» */
function retryLater(job: UploadJob, item: QueueItem, st: FileState, why: string) {
  const delay = RETRY_DELAYS[st.failures++];
  if (delay === undefined) {
    log(`✕ №${item.idx}: не уходит (${why}), ждёт кнопки «Повторить»`);
    patchItem(job.id, item.id, { status: "error", error: "Нет связи с сервером" });
    return;
  }
  log(`  №${item.idx}: ${why}, повтор через ${delay / 1000} с`);
  st.waitUntil = Date.now() + delay;
  setTimeout(pump, delay);
}

/** Сервер отказал по существу: кадр сбойный, а если повтор бессмыслен — окончательно */
function failFile(job: UploadJob, item: QueueItem, code: string, status: number) {
  const k = key(job.id, item.id);
  if (FATAL.includes(code)) fileStates.delete(k);
  patchItem(job.id, item.id, { status: "error", progress: 0, error: UPLOAD_ERRORS[code] ?? `Ошибка сервера (${status})`, fatal: FATAL.includes(code) });
  settle(job.id);
}

function sendPart(job: UploadJob, item: QueueItem, st: FileState, part: number) {
  const from = part * PART_BYTES;
  const to = Math.min(item.size, from + PART_BYTES);
  const k = `${key(job.id, item.id)}:${part}`;
  const ctrl = new AbortController();
  controllers.set(k, ctrl);
  st.sending.add(part);
  partsInFlight++;
  fetch(`/api/uploads/${job.id}/parts?idx=${item.idx}&offset=${from}&size=${item.size}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: item.file!.slice(from, to),
    signal: ctrl.signal,
  })
    .then(async (r) => {
      if (r.ok) {
        st.acked.add(part);
        st.failures = 0;
        setProgress(job.id, item.id, Math.min(99, (st.acked.size / st.parts) * 99));
        return;
      }
      const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "";
      // отменена загрузка, кончился вход, файл слишком большой: повтор не поможет
      if (code === "upload" || code === "auth" || code === "size") return failFile(job, item, code, r.status);
      retryLater(job, item, st, `кусочек ${part + 1} из ${st.parts}: ответ ${r.status}`);
    })
    .catch(() => {
      if (!ctrl.signal.aborted) retryLater(job, item, st, `кусочек ${part + 1} из ${st.parts}: нет связи`);
    })
    .finally(() => {
      st.sending.delete(part);
      controllers.delete(k);
      partsInFlight--;
      pump();
    });
}

/** Все кусочки дошли: сервер собирает файл и делает кадр */
function finish(job: UploadJob, item: QueueItem, st: FileState) {
  st.finishing = true;
  st.sentAt = performance.now();
  const ms = Math.round(st.sentAt - st.startedAt);
  log(`  №${item.idx}: передан за ${ms} мс (${rate(item.size, ms)}), ждём сервер`);
  const k = `${key(job.id, item.id)}:finish`;
  const ctrl = new AbortController();
  controllers.set(k, ctrl);
  fetch(`/api/uploads/${job.id}/frames?idx=${item.idx}&size=${item.size}`, { method: "POST", signal: ctrl.signal })
    .then(async (r) => {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      log(`← №${item.idx}: ответ ${r.status} за ${Math.round(performance.now() - st.startedAt)} мс (из них ждали сервер ${Math.round(performance.now() - st.sentAt)} мс)`, r.ok ? "" : data);
      if (r.ok) {
        fileStates.delete(key(job.id, item.id));
        patchItem(job.id, item.id, { status: "done", progress: 100 });
        return settle(job.id);
      }
      // сервер не нашёл всех кусочков (например, их стёрли): отправить файл заново
      if (data.error === "parts") {
        st.acked.clear();
        return retryLater(job, item, st, "сервер собрал не все кусочки");
      }
      if (data.error && data.error !== "storage") return failFile(job, item, data.error, r.status);
      retryLater(job, item, st, `сборка: ответ ${r.status}`);
    })
    .catch(() => {
      if (!ctrl.signal.aborted) retryLater(job, item, st, "сборка: нет связи");
    })
    .finally(() => {
      st.finishing = false;
      controllers.delete(k);
      pump();
    });
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
    controllers.forEach((c) => c.abort());
    controllers.clear();
    // sendBeacon доходит и из закрывающейся вкладки
    for (const job of active) navigator.sendBeacon(`/api/uploads/${job.id}/abort`);
    log(`вкладку закрыли: незаконченные загрузки отменены (${active.length}), их кадры будут стёрты`);
    setJobs(jobs.filter((j) => !isActive(j)));
  });
}
