"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dismissJob, retryJob, useShownInForm, useUploadJobs, type QueueItem, type UploadJob } from "@/lib/upload-queue";
import { CheckIcon, CloseIcon, RetryIcon } from "./icons";

/**
 * Как часто обновлять страницу, пока приходят кадры (чтобы папка и лента наполнялись на глазах). Каждое обновление —
 * запрос, который стоит в одной очереди с кусочками фото и с переходами по сайту, поэтому редко и только там,
 * где новые кадры видны: в ленте, в списке папок и в папке, куда идёт загрузка
 */
const REFRESH_EVERY_MS = 10_000;

/**
 * Окно загрузок в углу экрана: загрузка идёт в фоне (lib/upload-queue.ts), и из формы можно уйти на любую
 * страницу сайта. В окне каждый файл с состоянием и «Повторить» у сбойных; по умолчанию окно свёрнуто до итога.
 * Само не исчезает, закрывается крестиком после конца загрузки. Заодно обновляет страницу по мере прихода кадров.
 * Загрузку, которую показывает открытая форма, здесь не дублируем.
 */
export default function UploadIndicator() {
  const jobs = useUploadJobs();
  const inForm = useShownInForm();
  const router = useRouter();
  const pathname = usePathname();
  // на странице плёнки внизу по центру плашка с её данными (RollIsland.tsx): окно встаёт над ней
  const overIsland = /^\/rolls\/\d+/.test(pathname);
  // по умолчанию окно свёрнуто: развёрнутые загрузки помним, пока открыта вкладка
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Пришли новые кадры: обновляем страницу, если на ней их видно, и не чаще раза в 10 секунд.
  // Загрузка закончилась: обновляем сразу и где угодно (заодно сбрасывается память открытых страниц, next.config.ts)
  const doneCount = jobs.reduce((s, j) => s + j.items.filter((i) => i.status === "done" || i.shown).length, 0);
  const finishedCount = jobs.filter((j) => j.finished).length;
  const shows = pathname === "/" || pathname === "/rolls" || jobs.some((j) => !j.finished && pathname === `/rolls/${j.rollId}`);
  const last = useRef({ count: 0, finished: 0, at: 0 });
  useEffect(() => {
    if (finishedCount > last.current.finished) {
      last.current = { count: doneCount, finished: finishedCount, at: Date.now() };
      router.refresh();
      return;
    }
    last.current.finished = finishedCount;
    if (doneCount <= last.current.count || !shows) {
      if (doneCount < last.current.count) last.current.count = doneCount;
      return;
    }
    const wait = Math.max(0, last.current.at + REFRESH_EVERY_MS - Date.now());
    const timer = setTimeout(() => {
      last.current = { ...last.current, count: doneCount, at: Date.now() };
      router.refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [doneCount, finishedCount, shows, router]);

  const visible = jobs.filter((j) => j.id !== inForm);
  if (!visible.length) return null;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    // на телефоне над нижней панелью навигации, на широком экране в правом нижнем углу
    <div
      className={`fixed inset-x-3 z-40 flex flex-col gap-2 md:inset-x-auto md:right-5 md:w-96 ${
        overIsland ? "bottom-[9.5rem] md:bottom-[6.25rem]" : "bottom-20 md:bottom-5"
      }`}
      aria-live="polite"
    >
      {visible.map((job) => (
        <JobPanel key={job.id} job={job} collapsed={!expanded.has(job.id)} onToggle={() => toggle(job.id)} />
      ))}
    </div>
  );
}

function JobPanel({ job, collapsed, onToggle }: { job: UploadJob; collapsed: boolean; onToggle: () => void }) {
  const total = job.items.length;
  const done = job.items.filter((i) => i.status === "done").length;
  const failed = job.items.filter((i) => i.status === "error").length;
  const retryable = job.items.some((i) => i.status === "error" && !i.fatal);
  const progress = total ? job.items.reduce((s, i) => s + i.progress, 0) / total : 0;

  const summary = job.finished
    ? failed
      ? `Загружено ${done} из ${total}, не загружено: ${failed}`
      : "Все кадры загружены"
    : `${job.kind === "import" ? "С Яндекс Диска" : "Загружается"}: ${done} из ${total}`;

  return (
    <section className="overflow-hidden rounded-[16px] bg-paper-light text-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line" aria-label={`Загрузка «${job.title}»`}>
      {/* шапка: итог, свернуть/развернуть, закрыть (только когда загрузка закончилась) */}
      <div className="flex items-start gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="min-w-0 flex-1 text-left">
          <p className="truncate text-ink">{summary}</p>
          <p className="truncate text-xs text-ink-faint">{job.title}</p>
        </button>
        <button type="button" onClick={onToggle} className="shrink-0 text-xs text-accent-vivid transition-opacity hover:opacity-80">
          {collapsed ? "Развернуть" : "Свернуть"}
        </button>
        {job.finished && (
          <button type="button" onClick={() => dismissJob(job.id)} aria-label="Закрыть" className="-m-1 shrink-0 p-1 text-ink-faint hover:text-ink">
            <CloseIcon width={14} height={14} />
          </button>
        )}
      </div>

      {!job.finished && (
        <div className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-paper-edge" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {!collapsed && (
        <>
          <ul className="max-h-72 overflow-y-auto border-t border-line py-1">
            {job.items.map((item) => (
              <FileRow key={item.id} item={item} onRetry={() => retryJob(job.id, item.id)} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5">
            <Link href={`/rolls/${job.rollId}`} className="text-accent underline underline-offset-4">
              Открыть папку
            </Link>
            {retryable && (
              <button type="button" onClick={() => retryJob(job.id)} className="flex items-center gap-1 text-accent underline underline-offset-4">
                <RetryIcon width={13} height={13} /> Повторить все
              </button>
            )}
            {!job.finished && <p className="basis-full text-xs text-ink-faint">Не закрывайте вкладку до конца загрузки, иначе она отменится</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** Файл в окне: миниатюра, имя, размер и состояние; у сбойного — причина и «Повторить» (если повтор поможет) */
function FileRow({ item, onRetry }: { item: QueueItem; onRetry: () => void }) {
  const [broken, setBroken] = useState(false);
  const state =
    item.status === "done"
      ? "готово"
      : item.status === "error"
        ? item.error
        : item.status === "uploading"
          ? item.shown
            ? "в папке, оригинал в пути"
            : `${Math.round(item.progress)}%`
          : "ждёт очереди";

  return (
    <li className="flex items-center gap-3 px-4 py-1.5">
      <span className="relative size-10 shrink-0 overflow-hidden rounded-[6px] bg-paper-deep">
        {item.url && !broken && (
          // миниатюры с Диска Яндекс отдаёт только без Referer чужого сайта; лениво, чтобы длинный список не грузил все сразу
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
        )}
        {item.status === "done" && (
          <span className="absolute bottom-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-paper/90 text-ink">
            <CheckIcon width={10} height={10} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">{item.name}</span>
        <span className={`block truncate text-xs ${item.status === "error" ? "text-accent-vivid" : "text-ink-faint"}`}>
          {(item.size / 1048576).toFixed(1)} МБ · {state}
        </span>
      </span>
      {item.status === "error" && !item.fatal && (
        <button type="button" onClick={onRetry} className="flex shrink-0 items-center gap-1 text-xs text-accent underline underline-offset-4">
          <RetryIcon width={12} height={12} /> Повторить
        </button>
      )}
    </li>
  );
}
