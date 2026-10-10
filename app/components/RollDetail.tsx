"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useOptimistic, useRef, useState } from "react";
import {
  ISO_VALUES,
  MONTHS,
  VISIBILITIES,
  filmLabel,
  findFilm,
  formatLabel,
  makeTitle,
  rollView,
  type Camera,
  type Film,
  type Format,
  type Frame,
  type Roll,
  type RollEdit,
  type Visibility,
} from "@/lib/catalog";
import { deleteFrameAction, deleteRollAction, saveRollAction, setRollVisibilityAction } from "../rolls/[id]/actions";
import { control, Select } from "./fields";
import { LinkIcon } from "./icons";
import Masonry from "./Masonry";
import RollDescription from "./RollDescription";
import RollIsland from "./RollIsland";

const button = "rounded-control px-3.5 py-2 text-[11px] uppercase tracking-wider transition-colors";

/** Верх страницы папки (название, описание), кадры и остров с фактами, плюс правка папки на месте.
    Правки и удаление кадров сохраняются в базе (серверные действия), а на экране появляются сразу */
export default function RollDetail({
  roll,
  frames,
  cameras,
  films,
  canEdit,
  backHref,
}: {
  roll: Roll;
  frames: Frame[];
  cameras: Camera[];
  /** Справочник плёнок плюс свои плёнки автора */
  films: Film[];
  canEdit: boolean;
  /** Куда ведёт «назад»; без него ссылки нет (например, плёнку открыли по ссылке) */
  backHref?: string;
}) {
  const router = useRouter();
  const [current, applyEdit] = useOptimistic(roll, (cur, e: Partial<Roll>): Roll => ({ ...cur, ...e }));
  const [visible, removeFrame] = useOptimistic(frames, (cur, id: string) => cur.filter((f) => f.id !== id));
  // открыта одна из двух панелей под кнопками: правка папки или доступ
  const [panel, setPanel] = useState<"edit" | "access" | null>(null);
  const editing = panel === "edit";
  const visibility = current.visibility ?? "private";

  const film = findFilm(current.filmId, films);
  const view = rollView(current, cameras, visible.length, films);
  const title = view.title;

  const isoDiffers = film.iso && current.iso && film.iso !== current.iso;
  const facts: [string, string][] = [
    ["Камера", view.camera],
    ["Плёнка", view.film],
    ["ISO", current.iso ? `${current.iso}${isoDiffers ? ` (на плёнке ${film.iso})` : ""}` : "не указано"],
    ["Формат", formatLabel(current.format)],
    ["Начало съёмки", `${MONTHS[current.month - 1]} ${current.year}`],
    ["Кадров", String(visible.length)],
  ];

  const save = (e: RollEdit) => {
    startTransition(async () => {
      applyEdit(e);
      if (!(await saveRollAction(roll.id, e))) alert("Не удалось сохранить изменения");
    });
    closeForm();
  };
  const closeForm = () => setPanel(null);
  const setAccess = (v: Visibility) => {
    startTransition(async () => {
      applyEdit({ visibility: v });
      if (!(await setRollVisibilityAction(roll.id, v))) alert("Не удалось изменить доступ");
    });
  };
  // папка удаляется целиком и безвозвратно; после этого уходим к списку папок
  const deleteRoll = async () => {
    if (await deleteRollAction(roll.id)) router.push("/rolls");
    else alert("Не удалось удалить папку");
  };
  const deleteFrame = (id: string) => {
    startTransition(async () => {
      removeFrame(id);
      if (!(await deleteFrameAction(id))) alert("Не удалось удалить кадр");
    });
  };

  return (
    <>
      <header className="pb-6 pt-6 md:pt-8">
        <div className="relative flex items-center justify-between gap-4">
          {backHref && (
            <Link href={backHref} className="text-sm text-ink-faint transition-colors hover:text-ink">
              ← Все папки
            </Link>
          )}
          {canEdit && (
            <div className="ml-auto flex items-center gap-2">
              {/* доступ: значок ссылки и текущее значение; по нажатию выбор и ссылка */}
              <button
                type="button"
                aria-expanded={panel === "access"}
                aria-label={`Поделиться. Сейчас: ${VISIBILITIES.find((v) => v.id === visibility)?.short}`}
                title="Поделиться"
                onClick={() => setPanel(panel === "access" ? null : "access")}
                className={`${button} flex items-center gap-1.5 ${panel === "access" ? "bg-paper-edge text-ink" : "bg-paper-deep text-ink-faint hover:text-ink-soft"}`}
              >
                <LinkIcon width={13} height={13} />
                {VISIBILITIES.find((v) => v.id === visibility)?.short}
              </button>
              <button
                type="button"
                aria-expanded={editing}
                onClick={() => setPanel(editing ? null : "edit")}
                className={`${button} ${editing ? "bg-paper-edge text-ink" : "bg-paper-deep text-ink-faint hover:text-ink-soft"}`}
              >
                Изменить
              </button>
            </div>
          )}
          {/* выпадают под кнопками поверх страницы; название и описание на странице обновятся после «Сохранить» */}
          {canEdit && editing && (
            <EditPanel
              current={current}
              cameras={cameras}
              films={films}
              frameCount={visible.length}
              onSave={save}
              onCancel={closeForm}
              onDelete={deleteRoll}
            />
          )}
          {canEdit && panel === "access" && (
            <AccessPanel rollId={roll.id} shareKey={current.shareKey} visibility={visibility} onChange={setAccess} onClose={closeForm} />
          )}
        </div>

        <h1 className="mt-3 text-[26px] leading-[1.2] md:text-[40px]">{title}</h1>
        {current.description && <RollDescription text={current.description} />}
      </header>

      <Masonry frames={visible} rolls={{ [view.id]: view }} onDeleteFrame={canEdit ? deleteFrame : undefined} />
      {!editing && <RollIsland facts={facts} />}
    </>
  );
}

function EditPanel({
  current,
  cameras,
  films,
  frameCount,
  onSave,
  onCancel,
  onDelete,
}: {
  current: Roll;
  cameras: Camera[];
  films: Film[];
  frameCount: number;
  onSave: (e: RollEdit) => void;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({ ...current, title: current.title ?? "" });
  // удаление в два шага: сначала вопрос, потом само удаление
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const auto = makeTitle(findFilm(draft.filmId, films), draft.month, draft.year, draft.iso);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 12 }, (_, i) => Math.max(thisYear, draft.year) - i);
  if (!years.includes(draft.year)) years.push(draft.year);
  const isos = ISO_VALUES.includes(draft.iso ?? 0) || draft.iso === null ? ISO_VALUES : [...ISO_VALUES, draft.iso!].sort((a, b) => a - b);

  // Esc закрывает панель без сохранения
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const custom = draft.title.trim();
    onSave({
      // название, совпадающее с автоматическим, не фиксируем: оно продолжит следовать за плёнкой и датой
      title: custom && custom !== auto ? custom : null,
      description: draft.description.trim(),
      filmId: draft.filmId,
      cameraId: draft.cameraId,
      iso: draft.iso,
      format: draft.format,
      month: draft.month,
      year: draft.year,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="absolute inset-x-0 top-full z-30 mt-2 max-h-[calc(100dvh-14rem)] space-y-4 overflow-y-auto rounded-[20px] bg-paper-light px-5 pt-5 md:max-h-[calc(100dvh-9rem)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line sm:left-auto sm:w-[440px]"
    >
      <Field label="Название" hint="Пусто: название соберётся из плёнки, даты и ISO">
        <input autoFocus className={control} value={draft.title} placeholder={auto} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label="Описание">
        <textarea className={`${control} min-h-24 resize-y`} value={draft.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <div className="col-span-2">
        <Field label="Плёнка">
          <Select value={draft.filmId} onChange={(e) => set("filmId", e.target.value)}>
            {films.map((f) => (
              <option key={f.id} value={f.id}>
                {filmLabel(f)}
              </option>
            ))}
          </Select>
        </Field>
        </div>
        <div className="col-span-2">
        <Field label="Камера">
          <Select value={draft.cameraId} onChange={(e) => set("cameraId", e.target.value)}>
            {!cameras.some((c) => c.id === draft.cameraId) && <option value={draft.cameraId}>{draft.cameraId}</option>}
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        </div>
        <Field label="Формат">
          <Select value={draft.format} onChange={(e) => set("format", e.target.value as Format)}>
            <option value="35">35 мм</option>
            <option value="120">120</option>
          </Select>
        </Field>
        <Field label="ISO съёмки">
          <Select value={draft.iso ?? ""} onChange={(e) => set("iso", e.target.value ? Number(e.target.value) : null)}>
            <option value="">не указано</option>
            {isos.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Месяц начала съёмки">
          <Select value={draft.month} onChange={(e) => set("month", Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Год">
          <Select value={draft.year} onChange={(e) => set("year", Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="sticky bottom-0 -mx-5 bg-paper-light px-5 pb-5 pt-3">
        {confirming ? (
          <div role="alertdialog" aria-label="Удаление папки">
            <p className="text-sm text-ink-soft">
              Удалить папку{frameCount > 0 ? ` и все её кадры (${frameCount})` : ""}? Файлы сотрутся с сервера, вернуть их будет нельзя.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  await onDelete();
                  setDeleting(false);
                }}
                className={`${button} bg-accent text-ink hover:bg-accent-vivid disabled:opacity-50`}
              >
                {deleting ? "Удаляем…" : "Да, удалить"}
              </button>
              <button type="button" disabled={deleting} onClick={() => setConfirming(false)} className={`${button} bg-paper-deep text-ink-faint hover:text-ink-soft`}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="submit" className={`${button} bg-ink text-paper hover:bg-ink/85`}>
              Сохранить
            </button>
            <button type="button" onClick={onCancel} className={`${button} bg-paper-deep text-ink-faint hover:text-ink-soft`}>
              Отмена
            </button>
            <button type="button" onClick={() => setConfirming(true)} className={`${button} ml-auto text-accent-vivid hover:bg-paper-deep`}>
              Удалить
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

/** Кто видит плёнку: выбор сохраняется сразу; для «по ссылке» и «всем» показана ссылка, которую можно скопировать */
function AccessPanel({
  rollId,
  shareKey,
  visibility,
  onChange,
  onClose,
}: {
  rollId: number;
  shareKey?: string;
  visibility: Visibility;
  onChange: (v: Visibility) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // закрываем по Esc и по клику снаружи (кроме самой кнопки доступа: она закрывает панель сама)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest("[aria-expanded]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const link = `${window.location.origin}${visibility === "link" && shareKey ? `/s/${shareKey}` : `/rolls/${rollId}`}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // буфер обмена недоступен: ссылку можно выделить в поле вручную
    }
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Доступ к плёнке"
      className="absolute inset-x-0 top-full z-30 mt-2 rounded-[20px] bg-paper-light p-5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line sm:left-auto sm:w-[380px]"
    >
      <p className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ink-faint">Кто видит эту плёнку</p>
      <div role="radiogroup" className="space-y-1">
        {VISIBILITIES.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={visibility === v.id}
            onClick={() => onChange(v.id)}
            className={`flex w-full items-start gap-3 rounded-control px-3 py-2.5 text-left transition-colors ${visibility === v.id ? "bg-paper-edge" : "hover:bg-paper-deep"}`}
          >
            <span aria-hidden className={`mt-1 grid size-3.5 shrink-0 place-items-center rounded-full ring-1 ${visibility === v.id ? "ring-ink" : "ring-ink-faint"}`}>
              {visibility === v.id && <span className="size-1.5 rounded-full bg-ink" />}
            </span>
            <span>
              <span className={`block text-sm ${visibility === v.id ? "text-ink" : "text-ink-soft"}`}>{v.label}</span>
              <span className="block text-xs text-ink-faint">{v.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {visibility !== "private" && (
        <div className="mt-4">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-ink-faint">Ссылка</span>
          <div className="flex gap-2">
            <input readOnly aria-label="Ссылка на плёнку" className={`${control} min-w-0 flex-1`} onFocus={(e) => e.currentTarget.select()} value={link} />
            <button type="button" onClick={copy} className={`${button} shrink-0 bg-paper-deep text-ink-soft hover:text-ink`}>
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-ink-faint">{label}</span>
      <label className="block">{children}</label>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
