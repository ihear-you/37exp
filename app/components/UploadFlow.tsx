"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  UNKNOWN_FILM,
  findFilm,
  makeTitle,
  type Camera,
  type Film,
  type Format,
  type RollEdit,
} from "@/lib/catalog";
import { parseFolderName } from "@/lib/folder-name";
import { isImageFile, takeUploadHandoff, type UploadHandoff } from "@/lib/upload-handoff";
import {
  cancelJob,
  log,
  mb,
  releaseFromForm,
  renameJob,
  retryJob,
  setShownInForm,
  startFilesJob,
  startImportJob,
  useUploadJobs,
  type QueueItem,
} from "@/lib/upload-queue";
import { deleteRollAction, saveRollAction } from "../rolls/[id]/actions";
import { startImportAction, startUploadAction } from "../upload/actions";
import { control, Field, type PeriodValue } from "./fields";
import { CameraField, FilmField, PeriodPicker, filmValue, resolveFilmAndCamera, type FilmValue } from "./RollFields";
import { CheckIcon, ChevronIcon, RetryIcon } from "./icons";
import type { FanPic } from "./PhotoFan";
import BackButton from "./BackButton";
import UploadSources from "./UploadSources";

// Загрузка в два шага. Сначала две плитки (UploadSources): с устройства или по ссылке с Яндекс Диска. Как только
// кадры выбраны, загрузка начинается сразу: папка создаётся с лучшими догадками (плёнка, ISO и дата — по названию
// папки, камера и формат — как у прошлой плёнки), а рядом с кадрами карточка «Что это за плёнка?», где догадки
// можно поправить, пока кадры идут. Её можно и пропустить: всё правится потом на странице папки («Изменить»).
// Сама загрузка живёт в загрузчике (lib/upload-queue.ts), поэтому со страницы можно уйти в любой момент.

/** Как у прошлой плёнки: с них начинаются догадки для новой */
export interface UploadDefaults {
  cameraId: string;
  format: Format;
}

/** 1 файл, 2 файла, 5 файлов */
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;

type Draft = RollEdit;

/** Название папки-источника как название плёнки: «KodakGold200_июль2025» → «KodakGold200 июль2025» */
const cleanFolderName = (name: string) => name.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

/** Догадки для новой плёнки: по названию папки (с устройства или на Диске) и по прошлой плёнке */
function guessRoll(folder: string | null, films: Film[], defaults: UploadDefaults) {
  const g = folder ? parseFolderName(folder, films) : {};
  const now = new Date();
  const draft: Draft = {
    // название папки — то, как её назвал сам человек; плёнку и дату из него же подставляем в поля ниже
    title: folder ? cleanFolderName(folder) || null : null,
    filmId: g.filmId ?? UNKNOWN_FILM,
    iso: g.iso ?? null,
    // плёнка бывает только в другом формате (например, только 120) — берём его
    format: (() => {
      const formats = films.find((f) => f.id === g.filmId)?.formats ?? ["35" as const, "120" as const];
      return formats.includes(defaults.format) ? defaults.format : formats[0];
    })(),
    cameraId: defaults.cameraId,
    month: g.month ?? now.getMonth() + 1,
    year: g.year ?? now.getFullYear(),
    // «май-июнь 2026»: конец в том же году, «декабрь-январь» — в следующем
    endMonth: g.endMonth ?? null,
    endYear: g.endMonth ? (g.year ?? now.getFullYear()) + (g.endMonth < (g.month ?? 0) ? 1 : 0) : null,
    description: "",
  };
  return { draft };
}

export default function UploadFlow({
  films: savedFilms,
  cameras: savedCameras,
  defaults,
  photos,
  first,
}: {
  films: Film[];
  cameras: Camera[];
  defaults: UploadDefaults;
  /** Фото Unsplash для веера над плитками */
  photos: FanPic[];
  /** Плёнок ещё нет */
  first: boolean;
}) {
  // checking: смотрим, не выбраны ли кадры ещё на странице папок (lib/upload-handoff.ts); pick: плитки; upload: идёт загрузка
  const [phase, setPhase] = useState<"checking" | "pick" | "upload">("checking");
  const [films, setFilms] = useState(savedFilms);
  const [cameras, setCameras] = useState(savedCameras);

  /** Кадры до ответа сервера (после — их ведёт загрузчик) */
  const [items, setItems] = useState<QueueItem[]>([]);
  const [source, setSource] = useState<{ kind: "files" | "link"; folder: string | null; tooBig: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rollId, setRollId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const job = useUploadJobs().find((j) => j.id === jobId);
  const urls = useRef(new Set<string>());

  // миниатюры файлов, пока они только здесь; после старта их забирает загрузчик (он же их и освободит)
  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // эту загрузку показывает страница: окно в углу её не дублирует, пока страница открыта
  // Уходя, отдаём её окну в углу, но только если она ещё идёт или что-то не загрузилось (releaseFromForm)
  useEffect(() => {
    setShownInForm(jobId);
    return () => (jobId ? releaseFromForm(jobId) : setShownInForm(null));
  }, [jobId]);

  const begin = useCallback(
    async (picked: UploadHandoff) => {
      const t0 = performance.now();
      const folder = picked.kind === "files" ? picked.folder : picked.listing.name;
      const guess = guessRoll(folder, films, defaults);
      const title = guess.draft.title || makeTitle(findFilm(guess.draft.filmId, films), guess.draft, guess.draft.iso);
      let list: QueueItem[];
      if (picked.kind === "files") {
        list = picked.files
          .filter(isImageFile)
          .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
          .map((f, n) => {
            const url = URL.createObjectURL(f);
            urls.current.add(url);
            return { id: n + 1, name: f.name, size: f.size, url, file: f, idx: 0, status: "queued" as const, progress: 0 };
          });
        setSource({ kind: "files", folder, tooBig: 0 });
      } else {
        list = picked.listing.files.map((f, n) => ({
          id: -(n + 1),
          name: f.name,
          size: f.size,
          url: f.preview ?? undefined,
          idx: 0,
          status: "queued" as const,
          progress: 0,
        }));
        setSource({ kind: "link", folder, tooBig: picked.listing.tooBig });
      }
      setItems(list);
      setDraft(guess.draft);
      setStartError(null);
      setPhase("upload");
      log(`старт: ${list.length} кадров, ${mb(list.reduce((s, i) => s + i.size, 0))}, ${picked.kind === "link" ? "по ссылке с Диска" : "с устройства"}, новая плёнка «${title}»`);

      const roll = { ...guess.draft };
      if (picked.kind === "link") {
        const res = await startImportAction({ url: picked.url, rollId: null, roll });
        log(`импорт запущен за ${Math.round(performance.now() - t0)} мс:`, res.ok ? `задание ${res.importId}, плёнка ${res.rollId}` : res.error);
        if (!res.ok) return setStartError(res.error);
        startImportJob({ id: res.importId, rollId: res.rollId, title, created: true, items: list });
        setRollId(res.rollId);
        setJobId(res.importId);
        return;
      }
      const res = await startUploadAction({ rollId: null, roll, count: list.length, totalBytes: list.reduce((s, i) => s + i.size, 0) });
      log(`плёнка готова к приёму за ${Math.round(performance.now() - t0)} мс:`, res.ok ? `плёнка ${res.rollId}, номера с ${res.firstIdx}` : res.error);
      if (!res.ok) return setStartError(res.error);
      // миниатюры теперь показывает и окно загрузки в углу: страница их больше не освобождает
      list.forEach((i) => i.url && urls.current.delete(i.url));
      startFilesJob({ id: res.uploadId, rollId: res.rollId, title, created: true, items: list.map((i, n) => ({ ...i, idx: res.firstIdx + n })) });
      setRollId(res.rollId);
      setJobId(res.uploadId);
    },
    [films, defaults],
  );

  // Кадры выбраны ещё на странице папок: начинаем сразу. Через таймер, а не прямо в эффекте:
  // в dev React запускает эффекты дважды, и первый запуск отменяется
  useEffect(() => {
    const timer = setTimeout(() => {
      const handoff = takeUploadHandoff();
      if (handoff) void begin(handoff);
      else setPhase("pick");
    }, 0);
    return () => clearTimeout(timer);
    // только при открытии страницы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current.clear();
    setItems([]);
    setSource(null);
    setJobId(null);
    setRollId(null);
    setDraft(null);
    setStartError(null);
    setPhase("pick");
  };

  // Выбрали не те фото: загрузка отменяется, уже пришедшие кадры и созданная ею папка стираются, снова плитки
  // переспрашиваем прямо на странице, а не окном браузера: confirm() в некоторых браузерах молча не показывается
  const [confirmOthers, setConfirmOthers] = useState(false);
  /** На телефоне и планшете сетка фото свёрнута в строку превью: главное там — карточка плёнки */
  const [showAll, setShowAll] = useState(false);
  const chooseOthers = async () => {
    setConfirmOthers(false);
    if (jobId) cancelJob(jobId);
    if (rollId !== null) await deleteRollAction(rollId);
    reset();
  };

  if (phase === "checking") return <div className="min-h-[calc(100dvh-5rem)]" />;
  // «Назад» (на компьютере) только на шаге выбора и только когда архив уже есть: новому аккаунту возвращаться некуда,
  // а пока идёт загрузка, выход из неё ещё не решили
  if (phase === "pick")
    return (
      <div className="relative">
        {/* на телефоне вместо «Назад» нижний бар навигации */}
        {!first && (
          <div className="absolute left-0 top-6 z-10 hidden md:block">
            <BackButton />
          </div>
        )}
        <UploadSources photos={photos} onPick={(p) => void begin(p)} />
      </div>
    );

  // после старта кадры ведёт загрузчик
  const view = job?.items ?? items;
  const total = view.length;
  const done = view.filter((i) => i.status === "done").length;
  const overall = total ? view.reduce((s, i) => s + i.progress, 0) / total : 0;
  const finished = !!job?.finished;
  // причина у каждого кадра своя (видна на плитке и в окне в углу), здесь только сколько не загрузилось
  const failed = view.filter((i) => i.status === "error").length;
  const retryable = view.some((i) => i.status === "error" && !i.fatal);

  // один счётчик: сколько фото дошло целиком (у импорта — с оригиналом)
  const status = finished ? `Загружено фото: ${done} из ${total}` : `Загружаются фото: ${done} из ${total}`;

  return (
    // на телефоне по порядку: ход загрузки со строкой превью, раскрытая сетка кадров (если раскрыли), карточка;
    // на широком экране (lg) сетка видна всегда, а карточка справа во всю высоту
    <div className="grid gap-6 pb-28 pt-2 md:pb-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-0">

      {/* ── ход загрузки ── */}
      <section aria-label="Загрузка" className="min-w-0 lg:col-start-1 lg:row-start-1">
        <h1 className="text-[26px] leading-tight md:text-[36px]">Загрузка плёнки</h1>
        {source?.kind === "link" && (
          <p className="mt-2 text-sm text-ink-soft">
            Яндекс Диск, «{source.folder}»
            {/* не картинки (служебные файлы вроде .DS_Store, текстовые заметки) молча пропускаем, а большие фото — это кадры, о них говорим */}
            {source.tooBig > 0 && ` · не взяли слишком большие фото: ${source.tooBig}`}
          </p>
        )}

        {startError ? (
          <div className="mt-6 rounded-[16px] bg-paper-light px-4 py-3 text-sm ring-1 ring-line" role="alert">
            <p className="text-accent-vivid">{startError}</p>
            <button type="button" onClick={reset} className="mt-2 text-accent underline underline-offset-4">
              Выбрать другие кадры
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-ink" aria-live="polite">
              {status}
            </p>
            {!finished && (
              <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-paper-edge" role="progressbar" aria-valuenow={Math.round(overall)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${overall}%` }} />
              </div>
            )}
            {failed > 0 && (
              <p className="flex basis-full flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
                Не удалось загрузить {failed} {plural(failed, "файл", "файла", "файлов")}
                {retryable && jobId && (
                  <button type="button" onClick={() => retryJob(jobId)} className="flex items-center gap-1.5 text-accent underline underline-offset-4">
                    <RetryIcon width={14} height={14} /> Повторить все
                  </button>
                )}
              </p>
            )}
            {confirmOthers ? (
              <p className="flex basis-full flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft" role="alert">
                Загрузка отменится, а уже загруженные фото этой папки удалятся
                <button type="button" onClick={() => void chooseOthers()} className="text-accent-vivid underline underline-offset-4">
                  Выбрать другие
                </button>
                <button type="button" onClick={() => setConfirmOthers(false)} className="underline underline-offset-4 hover:text-ink">
                  Отмена
                </button>
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmOthers(true)}
                className="basis-full text-left text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
              >
                Выбрать другие фото
              </button>
            )}
          </div>
        )}
        {!startError && view.length > 0 && <Strip items={view} expanded={showAll} onToggle={() => setShowAll((v) => !v)} />}
      </section>

      <section aria-label="Кадры" className={`min-w-0 lg:col-start-1 lg:row-start-2 lg:block ${showAll ? "" : "hidden"}`}>
        <Thumbs items={view} started={!!job} onRetry={(id) => jobId && retryJob(jobId, id)} />
      </section>

      <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-24">
          {draft && !startError && (
            <RollCard
              draft={draft}
              rollId={rollId}
              films={films}
              cameras={cameras}
              finished={finished}
              onFilm={(f) => setFilms((p) => [...p, f])}
              onCamera={(c) => setCameras((p) => [...p, c])}
              onSaved={(d) => jobId && renameJob(jobId, d.title || makeTitle(findFilm(d.filmId, films), d, d.iso))}
            />
          )}
        </div>
      </aside>

    </div>
  );
}

/** Ниже lg: первые кадры маленькими превью и «+N»; нажатие раскрывает всю сетку (мельче, чем на компьютере) прямо под строкой */
function Strip({ items, expanded, onToggle }: { items: QueueItem[]; expanded: boolean; onToggle: () => void }) {
  const first = items.slice(0, 4);
  const rest = items.length - first.length;
  return (
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="mt-3 flex w-full items-center gap-1.5 text-left lg:hidden">
      {first.map((i) => (
        <span key={i.id} className="relative size-11 shrink-0 overflow-hidden rounded-[6px] bg-paper-deep ring-1 ring-line">
          {i.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={i.url}
              alt=""
              referrerPolicy="no-referrer"
              className={`size-full object-cover ${i.status === "done" || i.shown ? "" : "opacity-60"}`}
            />
          )}
        </span>
      ))}
      {rest > 0 && <span className="grid size-11 shrink-0 place-items-center rounded-[6px] bg-paper-deep text-xs text-ink-soft ring-1 ring-line">+{rest}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1 text-sm text-ink-soft">
        {expanded ? "Свернуть" : "Все фото"}
        <ChevronIcon width={12} height={12} className={expanded ? "-rotate-90" : "rotate-90"} />
      </span>
    </button>
  );
}

/** Сетка кадров с ходом загрузки каждого */
function Thumbs({ items, started, onRetry }: { items: QueueItem[]; started: boolean; onRetry: (id: number) => void }) {
  /** Миниатюры, которые не показались (Яндекс не сделал, браузер не умеет HEIC): вместо них название файла */
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1.5 lg:mt-5 lg:grid-cols-[repeat(auto-fill,minmax(88px,1fr))] lg:gap-2">
      {items.map((i) => (
        <li
          key={i.id}
          className="relative aspect-square overflow-hidden rounded-frame bg-paper-deep ring-1 ring-line"
          title={`${i.name} · ${(i.size / 1048576).toFixed(1)} МБ${i.error ? ` · ${i.error}` : ""}`}
        >
          {i.url && !broken.has(i.id) ? (
            // миниатюры с Диска Яндекс отдаёт только без Referer чужого сайта (иначе 403), поэтому не отправляем его
            <Image
              src={i.url}
              alt=""
              fill
              unoptimized
              referrerPolicy="no-referrer"
              onError={() => setBroken((prev) => new Set(prev).add(i.id))}
              sizes="120px"
              className={`object-cover transition-opacity ${i.status === "done" || i.shown || !started ? "opacity-100" : "opacity-60"}`}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center break-all p-1.5 text-center text-[10px] leading-tight text-ink-faint">{i.name}</span>
          )}
          {started && i.status !== "done" && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/15">
              <div className={`h-full ${i.status === "error" ? "bg-accent" : "bg-ink"}`} style={{ width: `${i.progress}%` }} />
            </div>
          )}
          {i.status === "done" && (
            <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-paper/90 text-ink shadow-sm">
              <CheckIcon width={12} height={12} />
            </span>
          )}
          {i.status === "error" && i.fatal && (
            // сервер отклонил файл окончательно: повтор не поможет, только причина
            <span className="absolute inset-0 grid place-items-center bg-paper/85 p-1.5 text-center text-[10px] leading-tight text-accent">{i.error}</span>
          )}
          {i.status === "error" && !i.fatal && (
            <button
              type="button"
              onClick={() => onRetry(i.id)}
              className="absolute inset-0 grid place-items-center bg-paper/85 text-accent"
              aria-label={`Повторить загрузку ${i.name}`}
            >
              <span className="flex flex-col items-center gap-1 text-[11px]">
                <RetryIcon width={18} height={18} />
                Повторить
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * «Что это за плёнка?» — поля уже заполнены догадками, папка с ними уже создана. «Сохранить и продолжить» меняет её
 * и ведёт в папку, «Не сохранять» — в папку без изменений; загрузка идёт дальше в фоне. Пока папка создаётся
 * (rollId ещё нет), уйти нельзя, но заполнять можно
 */
function RollCard({
  draft: initial,
  rollId,
  films,
  cameras,
  finished,
  onFilm,
  onCamera,
  onSaved,
}: {
  draft: Draft;
  rollId: number | null;
  films: Film[];
  cameras: Camera[];
  finished: boolean;
  onFilm: (f: Film) => void;
  onCamera: (c: Camera) => void;
  onSaved: (d: Draft) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title ?? "");
  const [film, setFilm] = useState<FilmValue>(() => filmValue(initial.filmId, initial.format, initial.iso, films));
  const [camera, setCamera] = useState(() => cameras.find((c) => c.id === initial.cameraId)?.name ?? "");
  const [period, setPeriod] = useState<PeriodValue>({ month: initial.month, year: initial.year, endMonth: initial.endMonth, endYear: initial.endYear });
  const [description, setDescription] = useState(initial.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auto = makeTitle(findFilm(film.filmId ?? UNKNOWN_FILM, films), period, film.iso);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rollId === null || saving) return;
    setSaving(true);
    setError(null);
    const ids = await resolveFilmAndCamera(film, camera, films, cameras);
    if (!ids) {
      setSaving(false);
      return setError("Не удалось сохранить плёнку или камеру, попробуйте ещё раз");
    }
    if (ids.newFilm) onFilm(ids.newFilm);
    if (ids.newCamera) onCamera(ids.newCamera);
    // название, совпадающее с автоматическим, не фиксируем: оно продолжит следовать за плёнкой и датой
    const custom = title.trim() || null;
    const edit: Draft = {
      title: custom && custom !== auto ? custom : null,
      description: description.trim(),
      filmId: ids.filmId,
      cameraId: ids.cameraId,
      iso: ids.iso,
      format: film.format,
      ...period,
    };
    if (!(await saveRollAction(rollId, edit))) {
      setSaving(false);
      return setError("Не удалось сохранить, попробуйте ещё раз");
    }
    onSaved(edit);
    router.push(`/rolls/${rollId}`);
  };

  return (
    <form onSubmit={save} className="space-y-4 rounded-[20px] bg-paper-light p-5 shadow-[var(--card-ring)]" aria-label="Что это за плёнка?">
      <h2 className="text-xl leading-tight">Что это за плёнка?</h2>

      <Field label="Название папки">
        <input className={control} value={title} placeholder={auto} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Плёнка">
        <FilmField value={film} films={films} onChange={setFilm} />
      </Field>
      <Field label="Камера">
        <CameraField value={camera} cameras={cameras} onChange={setCamera} />
      </Field>
      <Field label="Период съёмки">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Field>
      <Field label="Описание">
        <textarea
          className={`${control} min-h-14 resize-y`}
          value={description}
          placeholder="Где снимали, что за поездка"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {error && (
        <p className="text-sm text-accent-vivid" role="alert">
          {error}
        </p>
      )}
      <div className="border-t border-line pt-4">
        <p className="text-sm text-ink-soft">
          {finished ? "Все фото загружены" : "Фото загружаются в фоне. Не закрывайте вкладку, пока загрузка не закончится"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="submit"
            disabled={rollId === null || saving}
            className="rounded-control bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : rollId === null ? "Создаём папку…" : "Сохранить и продолжить"}
          </button>
          <button
            type="button"
            disabled={rollId === null}
            onClick={() => rollId !== null && router.push(`/rolls/${rollId}`)}
            className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink disabled:opacity-40"
          >
            Не сохранять
          </button>
        </div>
      </div>
    </form>
  );
}
