"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { feedSrc, MONTHS, type RollView } from "@/lib/catalog";

export interface RollCard extends RollView {
  /** Первые кадры плёнки для «контактной полоски» на карточке */
  strip: { id: string; w: number; h: number; color: string }[];
}

type Sort = "new" | "old";

interface Option {
  value: string;
  label: string;
  n: number;
}

const date = (r: RollView) => r.year * 12 + r.month;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Считает, сколько плёнок у каждого значения; порядок задаёт sort */
function options(rolls: RollView[], key: (r: RollView) => [string, string] | null, sort: (a: Option, b: Option) => number): Option[] {
  const map = new Map<string, Option>();
  for (const r of rolls) {
    const k = key(r);
    if (!k) continue;
    const o = map.get(k[0]) ?? { value: k[0], label: k[1], n: 0 };
    o.n++;
    map.set(k[0], o);
  }
  return [...map.values()].sort(sort);
}

/** Список плёнок карточками. Фильтры: плёнка, год, месяц и (если камер больше одной) камера.
    У каждого фильтра одно значение. Цвет и вайб здесь не участвуют */
export default function RollsBrowser({ rolls }: { rolls: RollCard[] }) {
  const [camera, setCamera] = useState("");
  const [film, setFilm] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [sort, setSort] = useState<Sort>("new");

  const cameras = useMemo(() => options(rolls, (r) => (r.cameraId ? [r.cameraId, r.camera] : null), (a, b) => a.label.localeCompare(b.label, "ru")), [rolls]);
  const films = useMemo(() => options(rolls, (r) => [r.filmId, r.film], (a, b) => a.label.localeCompare(b.label, "ru")), [rolls]);
  const years = useMemo(() => options(rolls, (r) => (r.year ? [String(r.year), String(r.year)] : null), (a, b) => Number(b.value) - Number(a.value)), [rolls]);
  const months = useMemo(
    () => options(rolls, (r) => (r.month > 0 ? [String(r.month), cap(MONTHS[r.month - 1])] : null), (a, b) => Number(a.value) - Number(b.value)),
    [rolls],
  );

  const shown = useMemo(() => {
    const list = rolls.filter(
      (r) =>
        (!camera || r.cameraId === camera) &&
        (!film || r.filmId === film) &&
        (!year || r.year === Number(year)) &&
        (!month || r.month === Number(month)),
    );
    return list.sort((a, b) => (sort === "new" ? date(b) - date(a) : date(a) - date(b)));
  }, [rolls, camera, film, year, month, sort]);

  const activeCount = [camera, film, year, month].filter(Boolean).length;
  const reset = () => {
    setCamera("");
    setFilm("");
    setYear("");
    setMonth("");
  };

  // одна строка: фильтры слева, сортировка справа; на узком экране строка переносится
  return (
    <div>
      <div className="sticky top-20 z-20 -mx-3 bg-paper/90 px-3 py-2.5 backdrop-blur-md md:-mx-5 md:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterMenu label="Плёнка" value={film} onChange={setFilm} options={films} />
          <FilterMenu label="Год" value={year} onChange={setYear} options={years} />
          <FilterMenu label="Месяц" value={month} onChange={setMonth} options={months} />
          {/* камера нужна, только когда их несколько */}
          {cameras.length > 1 && <FilterMenu label="Камера" value={camera} onChange={setCamera} options={cameras} />}
          {activeCount > 1 && (
            <button type="button" onClick={reset} className="px-1 text-[11px] uppercase tracking-wider text-ink-faint underline decoration-ink-faint/40 underline-offset-4 hover:text-ink-soft">
              Сбросить все
            </button>
          )}
          <button
            type="button"
            onClick={() => setSort(sort === "new" ? "old" : "new")}
            className={`${PILL} ${PILL_IDLE} ml-auto gap-1.5`}
            aria-label="Сортировка по дате"
          >
            {sort === "new" ? "Сначала новые" : "Сначала старые"}
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={sort === "old" ? "rotate-180" : ""}>
              <path d="M5 1v10M1.5 7.5L5 11l3.5-3.5" />
            </svg>
          </button>
        </div>
      </div>

      {shown.length ? (
        <ul className="grid grid-cols-1 gap-3 pb-16 pt-4 sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => (
            <li key={r.id}>
              <RollCardView roll={r} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-24 text-center">
          <p className="text-xl text-ink-soft">Ничего не нашлось</p>
          <button type="button" onClick={reset} className="mt-3 text-sm text-accent underline underline-offset-4">
            Сбросить фильтры
          </button>
        </div>
      )}
    </div>
  );
}

/** Сколько кадров плёнки веером на карточке и на сколько градусов раскрывается веер между соседними */
const FAN_MAX = 4;
const FAN_STEP = 6;
const FAN_STEP_HOVER = 9;
/** Сдвиг соседних кадров в сторону, % ширины самого кадра */
const FAN_SPREAD = 43;
const FAN_SPREAD_HOVER = 50;

/** Папка: кадры веером одного формата 3:4 (горизонтальные обрезаются, целиком их видно внутри папки),
    под ними название */
function RollCardView({ roll }: { roll: RollCard }) {
  const fan = roll.strip.slice(0, FAN_MAX);
  const mid = (fan.length - 1) / 2;

  return (
    <Link
      href={`/rolls/${roll.id}`}
      className="group block rounded-[20px] bg-paper-light p-5 text-center shadow-[var(--card-ring)] transition-shadow hover:shadow-[var(--card-ring-hover)]"
      style={{ ["--step" as string]: FAN_STEP, ["--step-hover" as string]: FAN_STEP_HOVER, ["--spread" as string]: FAN_SPREAD, ["--spread-hover" as string]: FAN_SPREAD_HOVER }}
    >
      <div className="relative aspect-[2/1] w-full">
        {fan.map((f, i) => (
          <div
            key={f.id}
            className="absolute bottom-[4%] left-1/2 aspect-[3/4] w-[34%] origin-bottom overflow-hidden rounded-[14px] shadow-[0_4px_14px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out [transform:translateX(calc(-50%+var(--k)*var(--spread)*1%))_rotate(calc(var(--k)*var(--step)*1deg))] group-hover:[transform:translateX(calc(-50%+var(--k)*var(--spread-hover)*1%))_rotate(calc(var(--k)*var(--step-hover)*1deg))]"
            style={{ ["--k" as string]: i - mid, zIndex: 10 - Math.round(Math.abs(i - mid)), backgroundColor: f.color }}
          >
            <Image src={feedSrc(f.id)} alt="" fill unoptimized sizes="200px" className="object-cover" />
          </div>
        ))}
      </div>
      <h2 className="mt-6 text-[15px] leading-snug group-hover:text-accent">{roll.title}</h2>
      <p className="mt-0.5 text-[13px] text-ink-soft">
        {[roll.camera, roll.iso ? `ISO ${roll.iso}` : null, roll.format === "120" ? "120" : null].filter(Boolean).join(" · ")}
      </p>
    </Link>
  );
}

/** Кнопки как вкладки в шапке: плашка без обводки, капс, заполненная при выборе */
const PILL = "inline-flex items-center rounded-control px-3.5 py-2 text-[11px] uppercase tracking-wider transition-colors";
const PILL_IDLE = "bg-paper-deep text-ink-faint hover:text-ink-soft";

/** Кнопка-фильтр с выпадающим списком значений. Выбрано значение: кнопка заполняется («Год: 2026»),
    рядом крестик, сбрасывающий только этот фильтр. Повторный клик по выбранному значению тоже сбрасывает */
function FilterMenu({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    // на телефоне список раскрывается по ширине всей панели фильтров, на широком экране под своей кнопкой
    <div ref={ref} className="sm:relative">
      <div className={`inline-flex items-center rounded-control transition-colors ${selected ? "bg-paper-edge" : "bg-paper-deep"}`}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`inline-flex items-center gap-1.5 py-2 pl-3.5 text-[11px] uppercase tracking-wider ${selected ? "pr-1.5 text-ink" : "pr-3.5 text-ink-faint hover:text-ink-soft"}`}
        >
          {selected ? `${label}: ${selected.label}` : label}
          {!selected && (
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={`text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}>
              <path d="M1 1l4 4 4-4" />
            </svg>
          )}
        </button>
        {selected && (
          <button type="button" aria-label={`Сбросить: ${label}`} onClick={() => onChange("")} className="px-2.5 py-2 text-ink-faint hover:text-ink">
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-control bg-paper-light p-1 shadow-[var(--card-ring-hover)] max-sm:inset-x-3 sm:min-w-[200px]"
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value === value ? "" : o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-[6px] px-3 py-2 text-left text-sm transition-colors hover:bg-paper-deep ${o.value === value ? "text-ink" : "text-ink-soft"}`}
              >
                <span className="flex-1">{o.label}</span>
                <span className="text-xs tabular-nums text-ink-faint">{o.n}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
