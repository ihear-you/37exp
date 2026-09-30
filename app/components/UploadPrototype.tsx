"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAMERAS,
  FILMS,
  ISO_VALUES,
  MONTHS,
  ROLLS,
  filmLabel,
  makeTitle,
  rollTitle,
  type Camera,
  type Film,
  type Format,
} from "@/lib/catalog";
import { parseFolderName } from "@/lib/folder-name";
import { createStore, useStore } from "@/lib/persist";
import { CheckIcon, RetryIcon, UploadIcon } from "./icons";

// Камеры запоминаются: последняя выбранная и добавленные вручную
interface CameraMemory {
  last: string;
  custom: Camera[];
}
const cameraStore = createStore<CameraMemory>("plenka:cameras", "local", () => ({ last: CAMERAS[0].id, custom: [] }));
const CAMERA_FALLBACK: CameraMemory = { last: CAMERAS[0].id, custom: [] };

type Status = "queued" | "uploading" | "done" | "error";
interface Item {
  id: number;
  name: string;
  size: number;
  url: string;
  status: Status;
  progress: number;
  speed: number;
  /** В прототипе каждый девятый кадр «сбоит» один раз, чтобы показать повторную загрузку */
  willFail: boolean;
}

const IMAGE = /\.(jpe?g|png|tiff?|webp|heic)$/i;
const NEW = "__new__";
const PARALLEL = 3;
const now = new Date();

export default function UploadPrototype() {
  const memory = useStore(cameraStore, CAMERA_FALLBACK);

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [rollId, setRollId] = useState("");
  const [filmId, setFilmId] = useState("");
  const [format, setFormat] = useState<Format>("35");
  const [iso, setIso] = useState("");
  const [cameraPick, setCameraPick] = useState<string | null>(null);
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [description, setDescription] = useState("");

  const [customFilms, setCustomFilms] = useState<Film[]>([]);
  const [addingFilm, setAddingFilm] = useState(false);
  const [newFilm, setNewFilm] = useState("");
  const [addingCamera, setAddingCamera] = useState(false);
  const [newCamera, setNewCamera] = useState("");

  const [items, setItems] = useState<Item[]>([]);
  const [started, setStarted] = useState(false);
  const [tried, setTried] = useState(false);
  const [hint, setHint] = useState<{ folder: string; found: string[] } | null>(null);
  const [drag, setDrag] = useState(false);

  const folderInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const urls = useRef<string[]>([]);

  const allFilms = useMemo(() => [...FILMS, ...customFilms], [customFilms]);
  const cameras = useMemo(() => [...CAMERAS, ...memory.custom], [memory.custom]);
  const cameraId = cameraPick ?? memory.last;
  const film = allFilms.find((f) => f.id === filmId);
  const existing = ROLLS.find((r) => String(r.id) === rollId);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // ── имитация загрузки: параллельно по три кадра, часть сбоит один раз ──
  const working = items.some((i) => i.status === "queued" || i.status === "uploading");
  useEffect(() => {
    if (!started || !working) return;
    const t = setInterval(() => {
      setItems((prev) => {
        let free = PARALLEL - prev.filter((i) => i.status === "uploading").length;
        return prev.map((i) => {
          if (i.status === "queued" && free > 0) {
            free--;
            return { ...i, status: "uploading" as const };
          }
          if (i.status !== "uploading") return i;
          const p = i.progress + i.speed;
          if (i.willFail && p >= 55) return { ...i, status: "error" as const, progress: 55 };
          if (p >= 100) return { ...i, status: "done" as const, progress: 100 };
          return { ...i, progress: p };
        });
      });
    }, 140);
    return () => clearInterval(t);
  }, [started, working]);

  const addFiles = useCallback((files: File[], folder: string | null) => {
    const images = files.filter((f) => f.type.startsWith("image/") || IMAGE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    if (!images.length) return;
    setItems((prev) => [
      ...prev,
      ...images.map((f, n) => {
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        const id = nextId.current++;
        return { id, name: f.name, size: f.size, url, status: "queued" as const, progress: 0, speed: 5 + ((id * 7) % 9), willFail: (prev.length + n) % 9 === 4 };
      }),
    ]);
    // только папка даёт подсказку: у отдельных файлов названия плёнки нет
    if (folder && mode === "new") {
      const g = parseFolderName(folder, [...FILMS, ...customFilms]);
      const found: string[] = [];
      if (g.filmId) {
        setFilmId(g.filmId);
        found.push(FILMS.find((f) => f.id === g.filmId)?.name ?? "");
      }
      if (g.iso) {
        setIso(String(g.iso));
        found.push(`ISO ${g.iso}`);
      }
      if (g.month) {
        setMonth(String(g.month));
        found.push(MONTHS[g.month - 1]);
      }
      if (g.year) {
        setYear(String(g.year));
        found.push(String(g.year));
      }
      setHint({ folder, found });
    } else if (!folder) {
      setHint(null);
    }
  }, [mode, customFilms]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const { files, folder } = await collect(e.dataTransfer);
    addFiles(files, folder);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>, isFolder: boolean) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    const folder = isFolder ? (files[0]?.webkitRelativePath.split("/")[0] ?? null) : null;
    addFiles(files, folder);
  };

  // ── справочники ──
  const pickFilm = (v: string) => {
    if (v === NEW) {
      setAddingFilm(true);
      return;
    }
    setFilmId(v);
    const f = allFilms.find((x) => x.id === v);
    if (f?.iso) setIso(String(f.iso));
  };
  const saveFilm = () => {
    const name = newFilm.trim();
    if (!name) return;
    const guessIso = Number(name.match(/(\d{2,4})\s*$/)?.[1]);
    const f: Film = {
      id: `custom-${customFilms.length + 1}`,
      name,
      iso: ISO_VALUES.includes(guessIso) ? guessIso : null,
      synonyms: [name.toLowerCase().replace(/[^a-z0-9а-яё]/g, "")],
    };
    setCustomFilms((p) => [...p, f]);
    setFilmId(f.id);
    if (f.iso) setIso(String(f.iso));
    setNewFilm("");
    setAddingFilm(false);
  };
  const pickCamera = (v: string) => {
    if (v === NEW) {
      setAddingCamera(true);
      return;
    }
    setCameraPick(v);
    cameraStore.set({ last: v });
  };
  const saveCamera = () => {
    const name = newCamera.trim();
    if (!name) return;
    const c: Camera = { id: `custom-${memory.custom.length + 1}`, name };
    cameraStore.set({ custom: [...memory.custom, c], last: c.id });
    setCameraPick(c.id);
    setNewCamera("");
    setAddingCamera(false);
  };

  // ── проверка и запуск ──
  const isoNum = iso ? Number(iso) : null;
  const title = mode === "existing" ? (existing ? rollTitle(existing) : "") : film ? makeTitle(film, Number(month), Number(year), isoNum) : "";
  const problems: string[] = [];
  if (mode === "existing" ? !existing : !film) problems.push(mode === "existing" ? "Выберите плёнку" : "Выберите плёнку из списка (можно «Не знаю»)");
  if (mode === "new" && !cameraId) problems.push("Выберите камеру");
  if (!items.length) problems.push("Добавьте кадры");

  const start = () => {
    setTried(true);
    if (problems.length) return;
    setStarted(true);
  };
  const retry = (id: number) => setItems((p) => p.map((i) => (i.id === id ? { ...i, status: "queued", progress: 0, willFail: false } : i)));
  const retryAll = () => setItems((p) => p.map((i) => (i.status === "error" ? { ...i, status: "queued", progress: 0, willFail: false } : i)));
  const reset = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setItems([]);
    setStarted(false);
    setTried(false);
    setHint(null);
  };

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;
  const total = items.length;
  const overall = total ? items.reduce((s, i) => s + i.progress, 0) / total : 0;
  const finished = started && total > 0 && done === total;
  const locked = started && !finished;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
      {/* ── форма ── */}
      <section aria-label="Данные плёнки" className={locked ? "pointer-events-none opacity-60" : ""}>
        <div className="mb-6 flex rounded-control p-0.5 ring-1 ring-line" role="group" aria-label="Сценарий">
          {(
            [
              ["new", "Новая плёнка"],
              ["existing", "Добавить в существующую"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => {
                setMode(id);
                setHint(null);
              }}
              className={`flex-1 rounded-control px-3 py-2 text-sm transition-colors ${mode === id ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">Название папки</p>
        <p className={`mt-1 min-h-[3.4rem] text-[20px] leading-snug ${title ? "" : "text-ink-faint/60"}`}>{title || "выберите плёнку"}</p>

        {mode === "existing" ? (
          <div className="mt-6 space-y-4">
            <Field label="Плёнка" error={tried && !existing}>
              <select className={control} value={rollId} onChange={(e) => setRollId(e.target.value)}>
                <option value="">Выберите плёнку…</option>
                {[...ROLLS].sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)).map((r) => (
                  <option key={r.id} value={r.id}>
                    {rollTitle(r)}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-sm text-ink-faint">Поля плёнки не меняются: кадры просто добавятся в её папку.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <Field label="Плёнка" error={tried && !film}>
              <select className={control} value={filmId} onChange={(e) => pickFilm(e.target.value)}>
                <option value="">Выберите…</option>
                {allFilms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {filmLabel(f)}
                  </option>
                ))}
                <option value={NEW}>＋ Добавить свою…</option>
              </select>
              {addingFilm && (
                <Inline
                  value={newFilm}
                  onChange={setNewFilm}
                  onSave={saveFilm}
                  onCancel={() => setAddingFilm(false)}
                  placeholder="Например, Kodak Vision3 500T"
                />
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Формат">
                <select className={control} value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="35">35 мм</option>
                  <option value="120">120</option>
                </select>
              </Field>
              <Field label="ISO съёмки" hint={film?.iso && isoNum && film.iso !== isoNum ? `на плёнке ${film.iso}: допишется в название` : undefined}>
                <select className={control} value={iso} onChange={(e) => setIso(e.target.value)}>
                  <option value="">не указано</option>
                  {ISO_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Камера" error={tried && !cameraId}>
              <select className={control} value={cameraId} onChange={(e) => pickCamera(e.target.value)}>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW}>＋ Добавить камеру…</option>
              </select>
              {addingCamera ? (
                <Inline value={newCamera} onChange={setNewCamera} onSave={saveCamera} onCancel={() => setAddingCamera(false)} placeholder="Название камеры" />
              ) : (
                <p className="mt-1 text-xs text-ink-faint">Последняя выбранная запоминается</p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Месяц начала съёмки">
                <select className={control} value={month} onChange={(e) => setMonth(e.target.value)}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Год">
                <select className={control} value={year} onChange={(e) => setYear(e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => now.getFullYear() - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Описание" hint="Здесь же можно написать место, поездку или что плёнка снималась дольше месяца">
              <textarea className={`${control} min-h-24 resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        )}
      </section>

      {/* ── кадры ── */}
      <section aria-label="Кадры" className="min-w-0">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded-[3px] border-2 border-dashed px-6 text-center transition-colors ${
            items.length ? "py-6" : "py-16"
          } ${drag ? "border-accent bg-accent/5" : "border-line bg-paper-light/60"}`}
        >
          <UploadIcon width={28} height={28} className="text-ink-faint" />
          <p className="mt-2 text-lg text-ink-soft">Перетащите папку или файлы сюда</p>
          <p className="mt-1 text-sm text-ink-faint">Папка подскажет плёнку, ISO и дату по своему названию, для отдельных файлов поля заполняются вручную</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => folderInput.current?.click()} className={ghost}>
              Выбрать папку
            </button>
            <label className={`${ghost} cursor-pointer`}>
              Выбрать файлы
              <input type="file" multiple accept="image/*" className="sr-only" onChange={(e) => onPick(e, false)} />
            </label>
            <input ref={folderInput} type="file" multiple className="sr-only" tabIndex={-1} onChange={(e) => onPick(e, true)} />
          </div>
        </div>

        {hint && (
          <p className="mt-3 rounded-[3px] bg-paper-deep px-3 py-2 text-sm text-ink-soft" role="status">
            Папка «{hint.folder}»:{" "}
            {hint.found.length ? <>заполнили по названию — {hint.found.join(", ")}. Проверьте и поправьте, если нужно.</> : "по названию ничего не распознали, заполните поля вручную."}
          </p>
        )}

        {items.length > 0 && (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm text-ink-soft" aria-live="polite">
                {started ? `Загружено ${done} из ${total}` : `Кадров: ${total}`}
                {failed > 0 && <span className="text-accent"> · не удалось: {failed}</span>}
              </p>
              {started && (
                <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-paper-edge" role="progressbar" aria-valuenow={Math.round(overall)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${overall}%` }} />
                </div>
              )}
              {failed > 0 && (
                <button type="button" onClick={retryAll} className="flex items-center gap-1.5 text-sm text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">
                  <RetryIcon width={14} height={14} /> Повторить все
                </button>
              )}
            </div>

            <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
              {items.map((i) => (
                <li key={i.id} className="relative aspect-square overflow-hidden rounded-frame bg-paper-deep ring-1 ring-line" title={`${i.name} · ${(i.size / 1048576).toFixed(1)} МБ`}>
                  <Image src={i.url} alt="" fill unoptimized sizes="120px" className={`object-cover transition-opacity ${i.status === "done" || !started ? "opacity-100" : "opacity-60"}`} />
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
                  {i.status === "error" && (
                    <button type="button" onClick={() => retry(i.id)} className="absolute inset-0 grid place-items-center bg-paper/85 text-accent" aria-label={`Повторить загрузку ${i.name}`}>
                      <span className="flex flex-col items-center gap-1 text-[11px]">
                        <RetryIcon width={18} height={18} />
                        Повторить
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {finished ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[3px] bg-paper-deep px-4 py-3" role="status">
              <CheckIcon className="text-ink" />
              <span className="text-sm">
                Готово: {total} кадров в «{title}». В прототипе ничего не сохраняется.
              </span>
              <Link href="/" className="text-sm text-accent underline underline-offset-4">
                К ленте
              </Link>
              <button type="button" onClick={reset} className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
                Загрузить ещё
              </button>
            </div>
          ) : (
            <>
              <button type="button" onClick={start} disabled={locked} className="rounded-control bg-ink px-6 py-2.5 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40">
                {locked ? "Загружается…" : items.length ? `Загрузить ${items.length} ${items.length === 1 ? "кадр" : "кадров"}` : "Загрузить"}
              </button>
              {items.length > 0 && !locked && (
                <button type="button" onClick={reset} className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
                  Очистить
                </button>
              )}
            </>
          )}
        </div>
        {tried && problems.length > 0 && !started && (
          <ul className="mt-3 space-y-0.5 text-sm text-accent" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const control =
  "w-full rounded-[3px] bg-paper-light px-3 py-2 text-sm ring-1 ring-line transition-shadow focus:outline-none focus:ring-2 focus:ring-ink/50";
const ghost = "rounded-control px-4 py-2 text-sm text-ink ring-1 ring-ink/40 transition-colors hover:bg-ink hover:text-paper";

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <span className={`mb-1 block text-[11px] uppercase tracking-[0.12em] ${error ? "text-accent" : "text-ink-faint"}`}>{label}</span>
      <label className="block">{children}</label>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function Inline({ value, onChange, onSave, onCancel, placeholder }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; placeholder: string }) {
  return (
    <span className="mt-2 flex gap-2">
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
      <button type="button" onClick={onSave} className="rounded-control bg-ink px-4 text-sm text-paper">
        Добавить
      </button>
      <button type="button" onClick={onCancel} className="px-1 text-sm text-ink-soft hover:text-ink">
        Отмена
      </button>
    </span>
  );
}

/** Файлы из перетаскивания: обходит вложенные папки; если бросили одну папку, отдаёт её название */
async function collect(dt: DataTransfer): Promise<{ files: File[]; folder: string | null }> {
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
