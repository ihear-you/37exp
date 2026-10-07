"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CAMERAS,
  FILMS,
  ISO_VALUES,
  MONTHS,
  filmLabel,
  findCamera,
  findFilm,
  formatLabel,
  makeTitle,
  rollView,
  type Format,
  type Frame,
  type Roll,
} from "@/lib/catalog";
import { editsStore, EDITS_FALLBACK, type RollEdit } from "@/lib/roll-edits";
import { useStore } from "@/lib/persist";
import { control, Select } from "./fields";
import Masonry from "./Masonry";
import RollDescription from "./RollDescription";
import RollIsland from "./RollIsland";

const button = "rounded-control px-3.5 py-2 text-[11px] uppercase tracking-wider transition-colors";

/** Верх страницы папки (название, описание), кадры и остров с фактами, плюс правка папки на месте.
    Правки накладываются на данные каталога (lib/roll-edits.ts) */
export default function RollDetail({ roll, frames }: { roll: Roll; frames: Frame[] }) {
  const edits = useStore(editsStore, EDITS_FALLBACK);
  const [editing, setEditing] = useState(false);

  const saved = edits.rolls[roll.id];
  const current: Roll = { ...roll, ...saved };
  const film = findFilm(current.filmId);
  const autoTitle = makeTitle(film, current.month, current.year, current.iso);
  const title = saved?.title || autoTitle;

  const visible = useMemo(() => frames.filter((f) => !edits.deletedFrames.includes(f.id)), [frames, edits.deletedFrames]);
  const view = { ...rollView(current), title, count: visible.length };

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
    editsStore.set({ rolls: { ...edits.rolls, [roll.id]: e } });
    closeForm();
  };
  const closeForm = () => setEditing(false);
  const deleteFrame = (id: string) => editsStore.set({ deletedFrames: [...edits.deletedFrames, id] });

  return (
    <>
      <header className="pb-6 pt-6 md:pt-8">
        <div className="relative flex items-center justify-between gap-4">
          <Link href="/rolls" className="text-sm text-ink-faint transition-colors hover:text-ink">
            ← Все папки
          </Link>
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
            className={`${button} ${editing ? "bg-paper-edge text-ink" : "bg-paper-deep text-ink-faint hover:text-ink-soft"}`}
          >
            Изменить
          </button>
          {/* выпадает под кнопкой поверх страницы; название и описание на странице обновятся после «Сохранить» */}
          {editing && <EditPanel current={current} title={saved?.title ?? ""} onSave={save} onCancel={closeForm} />}
        </div>

        <h1 className="mt-3 text-[26px] leading-[1.2] md:text-[40px]">{title}</h1>
        {current.description && <RollDescription text={current.description} />}
      </header>

      <Masonry frames={visible} rolls={{ [view.id]: view }} onDeleteFrame={deleteFrame} />
      {!editing && <RollIsland facts={facts} />}
    </>
  );
}

function EditPanel({ current, title, onSave, onCancel }: { current: Roll; title: string; onSave: (e: RollEdit) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ ...current, title });
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const auto = makeTitle(findFilm(draft.filmId), draft.month, draft.year, draft.iso);
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
      title: custom && custom !== auto ? custom : undefined,
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
            {FILMS.map((f) => (
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
            {!findCamera(draft.cameraId) && <option value={draft.cameraId}>{draft.cameraId}</option>}
            {CAMERAS.map((c) => (
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
