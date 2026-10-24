"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ISO_VALUES,
  UNKNOWN_FILM,
  filmLabel,
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
  log,
  mb,
  renameJob,
  retryJob,
  setShownInForm,
  startFilesJob,
  startImportJob,
  useUploadJobs,
  type QueueItem,
} from "@/lib/upload-queue";
import { saveRollAction } from "../rolls/[id]/actions";
import { createCameraAction, createFilmAction, startImportAction, startUploadAction } from "../upload/actions";
import { control, Field, PeriodFields, Select } from "./fields";
import { CheckIcon, RetryIcon } from "./icons";
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

const NEW = "__new__";

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
    format: defaults.format,
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
  useEffect(() => {
    setShownInForm(jobId);
    return () => setShownInForm(null);
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

  if (phase === "checking") return <div className="min-h-[calc(100dvh-5rem)]" />;
  // «Назад» только на шаге выбора и только когда архив уже есть: новому аккаунту возвращаться некуда,
  // а пока идёт загрузка, выход из неё ещё не решили
  if (phase === "pick")
    return (
      <div className="relative">
        {!first && (
          <div className="absolute left-0 top-6 z-10">
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
    // на телефоне по порядку: ход загрузки, карточка, кадры; на широком экране карточка справа во всю высоту
    <div className="grid gap-6 pb-10 pt-2 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-0">

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
          </div>
        )}
      </section>

      <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-24">
          {draft && !startError && (
            <RollCard
              draft={draft}
              rollId={rollId}
              films={films}
              cameras={cameras}
              onFilm={(f) => setFilms((p) => [...p, f])}
              onCamera={(c) => setCameras((p) => [...p, c])}
              note={
                job && (
                  <p className="text-sm text-ink-soft">
                    {finished ? (
                      <>
                        Плёнка видна только вам: доступ меняется на странице папки.{" "}
                        <Link href={`/rolls/${job.rollId}`} className="text-accent underline underline-offset-4">
                          Открыть папку
                        </Link>
                        {" · "}
                        <button type="button" onClick={reset} className="text-accent underline underline-offset-4">
                          Загрузить ещё
                        </button>
                      </>
                    ) : (
                      <>
                        Можно уйти на другие страницы сайта: загрузка продолжится, ход виден в углу экрана. Только не закрывайте вкладку
                        до конца, иначе загрузка отменится.{" "}
                        <Link href={`/rolls/${job.rollId}`} className="text-accent underline underline-offset-4">
                          Открыть папку
                        </Link>
                      </>
                    )}
                  </p>
                )
              }
              onSaved={(d) => {
                setDraft(d);
                if (jobId) renameJob(jobId, d.title || makeTitle(findFilm(d.filmId, films), d, d.iso));
              }}
            />
          )}
        </div>
      </aside>

      <section aria-label="Кадры" className="min-w-0 lg:col-start-1 lg:row-start-2">
        <Thumbs items={view} started={!!job} onRetry={(id) => jobId && retryJob(jobId, id)} />
      </section>
    </div>
  );
}

/** Сетка кадров с ходом загрузки каждого */
function Thumbs({ items, started, onRetry }: { items: QueueItem[]; started: boolean; onRetry: (id: number) => void }) {
  /** Миниатюры, которые не показались (Яндекс не сделал, браузер не умеет HEIC): вместо них название файла */
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 lg:mt-5">
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
 * «Что это за плёнка?» — поля уже заполнены догадками, папка с ними уже создана. «Сохранить» меняет её сразу,
 * «Пропустить» прячет карточку. Пока папка создаётся (rollId ещё нет), сохранить нельзя, но заполнять можно.
 */
function RollCard({
  draft: saved,
  rollId,
  films,
  cameras,
  onFilm,
  onCamera,
  onSaved,
  note,
}: {
  draft: Draft;
  /** Ход загрузки словами (можно уйти со страницы, открыть папку): внизу карточки в любом её виде */
  note?: React.ReactNode;
  rollId: number | null;
  films: Film[];
  cameras: Camera[];
  onFilm: (f: Film) => void;
  onCamera: (c: Camera) => void;
  onSaved: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<"edit" | "saving" | "saved" | "skipped">("edit");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"film" | "camera" | null>(null);
  const [newName, setNewName] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const film = findFilm(draft.filmId, films);
  const auto = makeTitle(film, draft, draft.iso);
  const title = draft.title?.trim() || auto;

  const pickFilm = (v: string) => {
    if (v === NEW) return setAdding("film");
    // ISO по плёнке; у «не знаю» ISO остаётся прежним (например, узнанным по названию папки)
    const f = findFilm(v, films);
    setDraft((d) => ({ ...d, filmId: v, iso: f.iso ?? (v === UNKNOWN_FILM ? d.iso : null) }));
  };
  const pickCamera = (v: string) => (v === NEW ? setAdding("camera") : set("cameraId", v));

  const addNew = async () => {
    const name = newName.trim();
    if (!name) return;
    if (adding === "film") {
      const guessIso = Number(name.match(/(\d{2,4})\s*$/)?.[1]);
      const f = await createFilmAction(name, ISO_VALUES.includes(guessIso) ? guessIso : null);
      if (!f) return setError("Не удалось добавить плёнку");
      onFilm(f);
      setDraft((d) => ({ ...d, filmId: f.id, iso: f.iso ?? d.iso }));
    } else {
      const c = await createCameraAction(name);
      if (!c) return setError("Не удалось добавить камеру");
      onCamera(c);
      set("cameraId", c.id);
    }
    setNewName("");
    setAdding(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rollId === null || state === "saving") return;
    setState("saving");
    setError(null);
    // название, совпадающее с автоматическим, не фиксируем: оно продолжит следовать за плёнкой и датой
    const custom = draft.title?.trim() || null;
    const edit = { ...draft, title: custom && custom !== auto ? custom : null, description: draft.description.trim() };
    const ok = await saveRollAction(rollId, edit);
    if (!ok) {
      setState("edit");
      return setError("Не удалось сохранить, попробуйте ещё раз");
    }
    onSaved(edit);
    setState("saved");
  };

  const card = "rounded-[20px] bg-paper-light p-5 shadow-[var(--card-ring)]";

  if (state === "skipped" || state === "saved") {
    return (
      <div className={card} role="status">
        {state === "saved" ? (
          <>
            <p className="flex items-center gap-2 text-sm text-ink">
              <CheckIcon width={14} height={14} /> Сохранили
            </p>
            <p className="mt-1 text-ink-soft">{title}</p>
          </>
        ) : (
          <p className="text-sm text-ink-soft">Данные плёнки можно поправить потом: «Изменить» на странице папки.</p>
        )}
        <button type="button" onClick={() => setState("edit")} className="mt-3 text-sm text-accent underline underline-offset-4">
          {state === "saved" ? "Изменить" : "Заполнить сейчас"}
        </button>
        {note && <div className="mt-4 border-t border-line pt-4">{note}</div>}
      </div>
    );
  }

  return (
    <form onSubmit={save} className={`${card} space-y-4`} aria-label="Что это за плёнка?">
      <h2 className="text-xl leading-tight">Что это за плёнка?</h2>

      <Field label="Название папки" hint="Пусто: соберётся из плёнки и даты">
        <input className={control} value={draft.title ?? ""} placeholder={auto} onChange={(e) => set("title", e.target.value)} />
      </Field>

      <Field label="Плёнка">
        <Select value={draft.filmId} onChange={(e) => pickFilm(e.target.value)}>
          {films.map((f) => (
            <option key={f.id} value={f.id}>
              {filmLabel(f)}
            </option>
          ))}
          <option value={NEW}>＋ Добавить свою…</option>
        </Select>
      </Field>
      {adding === "film" && <AddInline value={newName} onChange={setNewName} onSave={addNew} onCancel={() => setAdding(null)} placeholder="Например, Kodak Vision3 500T" />}

      <Field label="Камера">
        <Select value={draft.cameraId} onChange={(e) => pickCamera(e.target.value)}>
          <option value="">не указана</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>＋ Добавить камеру…</option>
        </Select>
      </Field>
      {adding === "camera" && <AddInline value={newName} onChange={setNewName} onSave={addNew} onCancel={() => setAdding(null)} placeholder="Например, Pentax 155g" />}

      <Field label="Формат">
        <Select value={draft.format} onChange={(e) => set("format", e.target.value as Format)}>
          <option value="35">35 мм</option>
          <option value="120">120, средний формат</option>
        </Select>
      </Field>

      <PeriodFields value={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} />

      <Field label="Описание">
        <textarea
          className={`${control} min-h-20 resize-y`}
          value={draft.description}
          placeholder="Где снимали, что за поездка"
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      {error && (
        <p className="text-sm text-accent-vivid" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={rollId === null || state === "saving"}
          className="rounded-control bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {state === "saving" ? "Сохраняем…" : rollId === null ? "Создаём папку…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => setState("skipped")} className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
          Пропустить
        </button>
      </div>
      {note && <div className="border-t border-line pt-4">{note}</div>}
    </form>
  );
}

function AddInline({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder: string;
}) {
  return (
    <span className="-mt-2 flex gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className={control}
      />
      <button type="button" onClick={onSave} className="shrink-0 rounded-control bg-ink px-3 text-sm text-paper">
        Добавить
      </button>
      <button type="button" onClick={onCancel} className="shrink-0 px-1 text-sm text-ink-soft hover:text-ink">
        Отмена
      </button>
    </span>
  );
}
