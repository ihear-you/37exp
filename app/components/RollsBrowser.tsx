"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { feedSrc, type RollView } from "@/lib/catalog";

export interface RollCard extends RollView {
  /** Первые кадры плёнки для «контактной полоски» на карточке */
  strip: { id: string; w: number; h: number; color: string }[];
}

type Sort = "new" | "old";

const date = (r: RollView) => r.year * 12 + r.month;

/** Список плёнок карточками. Фильтры: камера, плёнка, год. Цвет и вайб здесь не участвуют */
export default function RollsBrowser({ rolls }: { rolls: RollCard[] }) {
  const [camera, setCamera] = useState("");
  const [film, setFilm] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<Sort>("new");

  const cameras = useMemo(() => {
    const map = new Map<string, { name: string; n: number }>();
    for (const r of rolls) map.set(r.cameraId, { name: r.camera, n: (map.get(r.cameraId)?.n ?? 0) + 1 });
    return [...map.entries()];
  }, [rolls]);
  const films = useMemo(
    () => [...new Map(rolls.map((r) => [r.filmId, r.film])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ru")),
    [rolls],
  );
  const years = useMemo(() => [...new Set(rolls.map((r) => r.year))].sort((a, b) => b - a), [rolls]);

  const shown = useMemo(() => {
    const list = rolls.filter(
      (r) => (!camera || r.cameraId === camera) && (!film || r.filmId === film) && (!year || r.year === Number(year)),
    );
    return list.sort((a, b) => (sort === "new" ? date(b) - date(a) : date(a) - date(b)));
  }, [rolls, camera, film, year, sort]);

  const filtered = Boolean(camera || film || year);
  const reset = () => {
    setCamera("");
    setFilm("");
    setYear("");
  };

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-3 border-b border-line/60 bg-paper/90 px-3 py-2.5 backdrop-blur-md md:-mx-5 md:px-5">
        <div className="flex items-center gap-3">
          <div className="no-scrollbar -my-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1" role="group" aria-label="Камера">
            <Chip active={!camera} onClick={() => setCamera("")}>
              Все камеры
            </Chip>
            {cameras.map(([id, c]) => (
              <Chip key={id} active={camera === id} onClick={() => setCamera(camera === id ? "" : id)}>
                {c.name} <span className="ml-1 text-xs opacity-60">{c.n}</span>
              </Chip>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select label="Плёнка" value={film} onChange={setFilm} options={films.map(([id, name]) => [id, name])} />
          <Select label="Год" value={year} onChange={setYear} options={years.map((y) => [String(y), String(y)])} />
          {filtered && (
            <button type="button" onClick={reset} className="text-sm text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">
              Сбросить
            </button>
          )}
          <div className="ml-auto flex items-center gap-1 rounded-full p-0.5 ring-1 ring-line" role="group" aria-label="Сортировка по дате">
            {(
              [
                ["new", "Сначала новые"],
                ["old", "Сначала старые"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={sort === id}
                onClick={() => setSort(id)}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${sort === id ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="pb-3 pt-4 text-sm text-ink-faint" aria-live="polite">
        {shown.length} {plural(shown.length, ["плёнка", "плёнки", "плёнок"])}
        {filtered && ` из ${rolls.length}`}
      </p>

      {shown.length ? (
        <ul className="grid grid-cols-1 gap-3 pb-16 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id}>
              <RollCardView roll={r} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-24 text-center">
          <p className="font-display text-xl text-ink-soft">Ничего не нашлось</p>
          <button type="button" onClick={reset} className="mt-3 text-sm text-accent underline underline-offset-4">
            Сбросить фильтры
          </button>
        </div>
      )}
    </div>
  );
}

function RollCardView({ roll }: { roll: RollCard }) {
  // берём столько кадров, чтобы суммарная «ширина» была около 3,4 высоты: полоска получается одной высоты
  const strip: RollCard["strip"] = [];
  let sum = 0;
  for (const f of roll.strip) {
    const r = f.w / f.h;
    if (strip.length >= 2 && sum + r > 3.7) break;
    strip.push(f);
    sum += r;
  }

  return (
    <Link
      href={`/rolls/${roll.id}`}
      className="group block h-full rounded-[3px] bg-paper-light p-3 shadow-[0_0_0_1px_var(--line),0_1px_3px_rgba(0,0,0,.08)] transition-shadow hover:shadow-[0_0_0_1px_rgba(0,0,0,.35),0_6px_18px_rgba(0,0,0,.12)]"
    >
      <div className="flex items-start gap-1 bg-paper-deep p-1.5">
        {strip.map((f) => (
          <div key={f.id} className="relative overflow-hidden" style={{ flex: `${f.w / f.h} 1 0`, aspectRatio: f.w / f.h, backgroundColor: f.color }}>
            <Image src={feedSrc(f.id)} alt="" fill unoptimized sizes="200px" className="object-cover" />
          </div>
        ))}
      </div>
      <h2 className="font-display mt-3 text-[17px] leading-snug group-hover:text-accent">{roll.title}</h2>
      <p className="mt-1.5 text-sm text-ink-soft">
        {[roll.camera, roll.iso ? `ISO ${roll.iso}` : null, roll.format === "120" ? "120" : null, `${roll.count} ${plural(roll.count, ["кадр", "кадра", "кадров"])}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {roll.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-faint">{roll.description}</p>}
    </Link>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
        active ? "bg-ink text-paper" : "text-ink-soft ring-1 ring-line hover:bg-paper-deep hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none rounded-full bg-transparent py-1.5 pl-3.5 pr-8 text-sm ring-1 transition-colors hover:bg-paper-deep ${
          value ? "text-ink ring-ink/50" : "text-ink-soft ring-line"
        }`}
      >
        <option value="">{label}: все</option>
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M1 1l4 4 4-4" />
      </svg>
    </label>
  );
}

function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
