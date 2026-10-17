"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { dismissJob, retryJob, useShownInForm, useUploadJobs, type UploadJob } from "@/lib/upload-queue";
import { CheckIcon, CloseIcon, RetryIcon } from "./icons";

/** Сколько ждать между обновлениями страницы, пока приходят кадры (чтобы папка и лента наполнялись на глазах) */
const REFRESH_EVERY_MS = 3000;

/**
 * Ход загрузок в углу экрана: загрузка идёт в фоне (lib/upload-queue.ts), и из формы можно уйти на любую
 * страницу сайта. Заодно обновляет страницу по мере прихода кадров. Загрузку, которую показывает открытая
 * форма, здесь не дублируем.
 */
export default function UploadIndicator() {
  const jobs = useUploadJobs();
  const inForm = useShownInForm();
  const router = useRouter();

  // пришли новые кадры или загрузка закончилась: обновляем страницу, но не чаще раза в 3 секунды
  const doneCount = jobs.reduce((s, j) => s + j.items.filter((i) => i.status === "done" || i.shown).length + (j.finished ? 1 : 0), 0);
  const last = useRef({ count: 0, at: 0 });
  useEffect(() => {
    if (doneCount <= last.current.count) {
      last.current.count = doneCount;
      return;
    }
    const wait = Math.max(0, last.current.at + REFRESH_EVERY_MS - Date.now());
    const timer = setTimeout(() => {
      last.current = { count: doneCount, at: Date.now() };
      router.refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [doneCount, router]);

  const visible = jobs.filter((j) => j.id !== inForm);
  if (!visible.length) return null;

  return (
    // на телефоне над нижней панелью навигации, на широком экране в правом нижнем углу
    <div className="fixed inset-x-3 bottom-20 z-40 flex flex-col gap-2 md:inset-x-auto md:bottom-5 md:right-5 md:w-80" aria-live="polite">
      {visible.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: UploadJob }) {
  const total = job.items.length;
  const done = job.items.filter((i) => i.status === "done").length;
  const failed = job.items.filter((i) => i.status === "error").length;
  const retryable = job.items.some((i) => i.status === "error" && !i.fatal);
  const progress = total ? job.items.reduce((s, i) => s + i.progress, 0) / total : 0;

  return (
    <div className="rounded-[16px] bg-paper-light p-4 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line">
      <div className="flex items-start gap-2">
        {job.finished && <CheckIcon width={16} height={16} className="mt-0.5 shrink-0 text-ink" />}
        <p className="min-w-0 flex-1 truncate text-ink">{job.title}</p>
        {job.finished && (
          <button type="button" onClick={() => dismissJob(job.id)} aria-label="Скрыть" className="-m-1 p-1 text-ink-faint hover:text-ink">
            <CloseIcon width={14} height={14} />
          </button>
        )}
      </div>

      {job.finished ? (
        <p className="mt-1 text-ink-soft">
          Готово: {done} из {total}
          {failed > 0 && `, не загружено: ${failed}`}
        </p>
      ) : (
        <>
          <p className="mt-1 text-ink-soft">
            {job.kind === "import" ? "С Яндекс Диска" : "Загружено"} {done} из {total}
            {failed > 0 && <span className="text-accent-vivid"> · не удалось: {failed}</span>}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-edge" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-faint">Не закрывайте вкладку до конца загрузки, иначе она отменится</p>
        </>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link href={`/rolls/${job.rollId}`} className="text-accent underline underline-offset-4">
          Открыть папку
        </Link>
        {retryable && (
          <button type="button" onClick={() => retryJob(job.id)} className="flex items-center gap-1 text-accent underline underline-offset-4">
            <RetryIcon width={13} height={13} /> Повторить
          </button>
        )}
      </div>
    </div>
  );
}
