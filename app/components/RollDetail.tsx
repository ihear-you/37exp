"use client";

import Link from "next/link";
import { startTransition, useEffect, useOptimistic, useState } from "react";
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
import { deleteFrameAction, saveRollAction } from "../rolls/[id]/actions";
import Masonry from "./Masonry";
import RollDescription from "./RollDescription";
import RollIsland from "./RollIsland";

const control =
  "w-full rounded-control bg-paper-light px-3 py-2 text-sm ring-1 ring-line transition-shadow focus:outline-none focus:ring-2 focus:ring-ink/50";
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
  const [current, applyEdit] = useOptimistic(roll, (cur, e: RollEdit): Roll => ({ ...cur, ...e }));
  const [visible, removeFrame] = useOptimistic(frames, (cur, id: string) => cur.filter((f) => f.id !== id));
  const [editing, setEditing] = useState(false);

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
  const closeForm = () => setEditing(false);
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
            <button
              type="button"
              aria-expanded={editing}
              onClick={() => setEditing(!editing)}
              className={`${button} ${editing ? "bg-paper-edge text-ink" : "bg-paper-deep text-ink-faint hover:text-ink-soft"}`}
            >
              Изменить
            </button>
          )}
          {/* выпадает под кнопкой поверх страницы; название и описание на странице обновятся после «Сохранить» */}
          {canEdit && editing && <EditPanel current={current} cameras={cameras} films={films} onSave={save} onCancel={closeForm} />}
        </div>

        <h1 className="mt-3 text-[26px] leading-[1.2] md:text-[40px]">{title}</h1>
        {current.description && <RollDescription text={current.description} />}
      </header>

      <Masonry frames={visible} rolls={{ [view.id]: view }} onDeleteFrame={canEdit ? deleteFrame : undefined} />
      {!editing && <RollIsland facts={facts} />}
    </>
  );
}

function EditPanel({ current, cameras, films, onSave, onCancel }: { current: Roll; cameras: Camera[]; films: Film[]; onSave: (e: RollEdit) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ ...current, title: current.title ?? "", visibility: current.visibility ?? ("private" as Visibility) });
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
      visibility: draft.visibility,
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
          <select className={control} value={draft.filmId} onChange={(e) => set("filmId", e.target.value)}>
            {films.map((f) => (
              <option key={f.id} value={f.id}>
                {filmLabel(f)}
              </option>
            ))}
          </select>
        </Field>
        </div>
        <div className="col-span-2">
        <Field label="Камера">
          <select className={control} value={draft.cameraId} onChange={(e) => set("cameraId", e.target.value)}>
            {!cameras.some((c) => c.id === draft.cameraId) && <option value={draft.cameraId}>{draft.cameraId}</option>}
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        </div>
        <Field label="Формат">
          <select className={control} value={draft.format} onChange={(e) => set("format", e.target.value as Format)}>
            <option value="35">35 мм</option>
            <option value="120">120</option>
          </select>
        </Field>
        <Field label="ISO съёмки">
          <select className={control} value={draft.iso ?? ""} onChange={(e) => set("iso", e.target.value ? Number(e.target.value) : null)}>
            <option value="">не указано</option>
            {isos.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Месяц начала съёмки">
          <select className={control} value={draft.month} onChange={(e) => set("month", Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Год">
          <select className={control} value={draft.year} onChange={(e) => set("year", Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Кто видит эту плёнку">
        <select className={control} value={draft.visibility} onChange={(e) => set("visibility", e.target.value as Visibility)}>
          {VISIBILITIES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
      {draft.visibility !== "private" && (
        <Field
          label="Ссылка"
          hint={draft.visibility === "link" ? "Работает только у тех, кому вы её отправили. Сохраните, чтобы ссылка заработала." : "Эту плёнку видят все, она есть на вашей странице."}
        >
          <input
            readOnly
            className={control}
            onFocus={(e) => e.currentTarget.select()}
            value={`${window.location.origin}${draft.visibility === "link" && current.shareKey ? `/s/${current.shareKey}` : `/rolls/${current.id}`}`}
          />
        </Field>
      )}

      <div className="sticky bottom-0 -mx-5 flex gap-2 bg-paper-light px-5 pb-5 pt-3">
        <button type="submit" className={`${button} bg-ink text-paper hover:bg-ink/85`}>
          Сохранить
        </button>
        <button type="button" onClick={onCancel} className={`${button} bg-paper-deep text-ink-faint hover:text-ink-soft`}>
          Отмена
        </button>
      </div>
    </form>
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
