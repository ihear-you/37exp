"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CAMERA_CATALOG } from "@/lib/cameras";
import { ISO_VALUES, MONTHS, UNKNOWN_FILM, periodLabel, type Camera, type Film, type Format } from "@/lib/catalog";
import { createCameraAction, createFilmAction } from "../upload/actions";
import { control, type PeriodValue } from "./fields";
import { CalendarIcon, ChevronIcon } from "./icons";

// Поля плёнки, общие для карточки «Что это за плёнка?» (UploadFlow.tsx) и окна «Изменить» (RollDetail.tsx):
// плёнка и камера — поле ввода с подсказками (своё значение тоже можно вписать), период — выбор месяцев.

// «120» — название типа плёнки, а не миллиметры (она шириной 61 мм), поэтому без «мм», но с пояснением
const FORMAT_LABEL: Record<Format, string> = { "35": "35 мм", "120": "120, средний формат" };

/** Для поиска: без регистра, ё = е, без пробелов и знаков («t42l» найдёт «Tasma T-42L») */
const squash = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9а-я]/g, "");
/** Каждое слово запроса должно найтись в названии */
const matches = (name: string, query: string) => {
  const target = squash(name);
  return query
    .split(/\s+/)
    .map(squash)
    .filter(Boolean)
    .every((w) => target.includes(w));
};

interface Option {
  key: string;
  label: string;
  /** Тихая подпись справа (формат плёнки) */
  hint?: string;
}

/** Поле ввода с подсказками: список под полем, стрелки и Enter, Esc закрывает. Подсказка не обязательна */
function Suggest({
  value,
  onChange,
  options,
  onPick,
  placeholder,
  suffix,
  suffixPad = "pr-20",
}: {
  value: string;
  onChange: (text: string) => void;
  options: Option[];
  onPick: (key: string) => void;
  placeholder?: string;
  /** Кнопка внутри поля справа (формат плёнки) и сколько места ей оставить, чтобы текст под неё не заезжал */
  suffix?: React.ReactNode;
  suffixPad?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useId();
  const shown = open ? options.slice(0, 8) : [];

  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        className={`${control} ${suffix ? suffixPad : ""}`}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        // клик по подсказке случается раньше, чем поле теряет фокус: закрываем с небольшой задержкой
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!shown.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + shown.length) % shown.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(shown[Math.min(active, shown.length - 1)].key);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {suffix && <span className="absolute inset-y-0 right-2 flex items-center">{suffix}</span>}
      {shown.length > 0 && (
        <ul
          id={list}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-control bg-paper-light py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line"
        >
          {shown.map((o, i) => (
            <li
              key={o.key}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.key);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-paper-deep text-ink" : "text-ink-soft"}`}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-ink-faint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Плёнка в форме: что вписано, какая из справочника выбрана (null — своя или пусто), формат и ISO */
export interface FilmValue {
  text: string;
  filmId: string | null;
  format: Format;
  iso: number | null;
}

export const filmValue = (filmId: string, format: Format, iso: number | null, films: readonly Film[]): FilmValue => {
  const film = films.find((f) => f.id === filmId);
  return { text: film && film.id !== UNKNOWN_FILM ? film.name : "", filmId: film && film.id !== UNKNOWN_FILM ? film.id : null, format, iso };
};

/**
 * Плёнка: подсказки из своих плёнок и справочника, по строке на каждый формат («Kodak Portra 400 · 120»).
 * Выбрали строку — заодно выбран формат. Вписали свою — формат меняется кнопкой справа в поле
 */
export function FilmField({ value, films, onChange }: { value: FilmValue; films: readonly Film[]; onChange: (v: FilmValue) => void }) {
  const options = useMemo(() => {
    const own = films.filter((f) => f.id.startsWith("u-"));
    const catalog = films.filter((f) => !f.id.startsWith("u-") && f.id !== UNKNOWN_FILM);
    return [...own, ...catalog]
      .filter((f) => matches(f.name, value.text))
      .flatMap((f) => (f.formats ?? ["35" as const]).map((format) => ({ key: `${f.id}|${format}`, label: f.name, hint: FORMAT_LABEL[format] })));
  }, [films, value.text]);

  return (
    <Suggest
      value={value.text}
      placeholder="Например, Kodak Gold 200"
      options={options}
      suffixPad={value.format === "120" ? "pr-40" : "pr-20"}
      onChange={(text) => {
        // вписанное совпало с плёнкой из списка — считаем её выбранной
        const same = films.find((f) => f.id !== UNKNOWN_FILM && squash(f.name) === squash(text));
        onChange({ ...value, text, filmId: same?.id ?? null, iso: same ? same.iso : value.iso });
      }}
      onPick={(key) => {
        const [id, format] = key.split("|") as [string, Format];
        const film = films.find((f) => f.id === id)!;
        onChange({ text: film.name, filmId: film.id, format, iso: film.iso });
      }}
      suffix={
        <button
          type="button"
          title="Формат плёнки: нажмите, чтобы сменить"
          onClick={() => onChange({ ...value, format: value.format === "35" ? "120" : "35" })}
          className="rounded-[6px] px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink"
        >
          {FORMAT_LABEL[value.format]}
        </button>
      }
    />
  );
}

/** Камера: подсказки из своих камер и справочника; можно вписать любую */
export function CameraField({ value, cameras, onChange }: { value: string; cameras: readonly Camera[]; onChange: (text: string) => void }) {
  const options = useMemo(() => {
    const names = [...cameras.map((c) => c.name), ...CAMERA_CATALOG];
    const seen = new Set<string>();
    return names
      .filter((n) => {
        const k = squash(n);
        if (seen.has(k)) return false;
        seen.add(k);
        return matches(n, value);
      })
      .map((n) => ({ key: n, label: n }));
  }, [cameras, value]);
  return <Suggest value={value} placeholder="Например, Pentax K1000" options={options} onChange={onChange} onPick={onChange} />;
}

/**
 * Перед сохранением: вписанные плёнка и камера → их номера. Совпадающая по названию берётся как есть,
 * новая заводится у пользователя. Пустая плёнка — «не знаю», пустая камера — не указана. null — не удалось
 */
export async function resolveFilmAndCamera(
  film: FilmValue,
  cameraText: string,
  films: readonly Film[],
  cameras: readonly Camera[],
): Promise<{ filmId: string; iso: number | null; cameraId: string; newFilm?: Film; newCamera?: Camera } | null> {
  const out: { filmId: string; iso: number | null; cameraId: string; newFilm?: Film; newCamera?: Camera } = { filmId: UNKNOWN_FILM, iso: film.iso, cameraId: "" };
  const filmName = film.text.trim();
  if (filmName) {
    const known = films.find((f) => f.id === film.filmId) ?? films.find((f) => f.id !== UNKNOWN_FILM && squash(f.name) === squash(filmName));
    if (known) out.filmId = known.id;
    else {
      const guessIso = Number(filmName.match(/(\d{2,4})\s*$/)?.[1]);
      const created = await createFilmAction(filmName, ISO_VALUES.includes(guessIso) ? guessIso : null);
      if (!created) return null;
      out.filmId = created.id;
      out.iso = created.iso ?? film.iso;
      out.newFilm = created;
    }
  }
  const cameraName = cameraText.trim();
  if (cameraName) {
    const known = cameras.find((c) => squash(c.name) === squash(cameraName));
    if (known) out.cameraId = known.id;
    else {
      const created = await createCameraAction(cameraName);
      if (!created) return null;
      out.cameraId = created.id;
      out.newCamera = created;
    }
  }
  return out;
}

const at = (year: number, month: number) => year * 12 + month;

/**
 * Период съёмки одним полем: «Июль – август 2026». По нажатию — месяцы года сеткой: первый клик — начало,
 * второй — конец (тот же месяц ещё раз — плёнку сняли за месяц). Будущие месяцы выбрать нельзя
 */
export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.year);
  /** Выбор года сеткой (по 12 лет на страницу); lastYear — последний год на странице */
  const [years, setYears] = useState<{ lastYear: number } | null>(null);
  /** Первый месяц уже выбран и записан: второй месяц сделает из него период */
  const [start, setStart] = useState<{ year: number; month: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const now = new Date();
  const nowAt = at(now.getFullYear(), now.getMonth() + 1);

  const close = useCallback(() => {
    setOpen(false);
    setYears(null);
    setStart(null);
    setHover(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const choose = (month: number) => {
    // чаще всего плёнка снята за один месяц: первое нажатие — уже готовый выбор, окно остаётся открытым для периода
    if (!start) {
      onChange({ year, month, endYear: null, endMonth: null });
      setStart({ year, month });
      return;
    }
    let a = at(start.year, start.month);
    let b = at(year, month);
    if (b < a) [a, b] = [b, a];
    const from = { year: Math.floor((a - 1) / 12), month: ((a - 1) % 12) + 1 };
    const to = { year: Math.floor((b - 1) / 12), month: ((b - 1) % 12) + 1 };
    onChange({ ...from, endYear: a === b ? null : to.year, endMonth: a === b ? null : to.month });
    close();
  };

  // что подсветить: выбранный период, а пока выбирается — от начала до месяца под курсором
  const selFrom = start ? at(start.year, start.month) : at(value.year, value.month);
  const selTo = start ? (hover ?? selFrom) : value.endYear && value.endMonth ? at(value.endYear, value.endMonth) : selFrom;
  const [lo, hi] = selFrom <= selTo ? [selFrom, selTo] : [selTo, selFrom];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setYear(value.endYear ?? value.year);
          setOpen(true);
        }}
        className={`${control} flex items-center justify-between text-left`}
      >
        <span>{periodLabel(value, true)}</span>
        <CalendarIcon width={16} height={16} className="text-ink-faint" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 rounded-[14px] bg-paper-light p-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label={years ? "Раньше" : "Предыдущий год"}
              onClick={() => (years ? setYears({ lastYear: years.lastYear - 12 }) : setYear((y) => y - 1))}
              className="rounded-control p-2 text-ink-soft hover:bg-paper-deep hover:text-ink"
            >
              <ChevronIcon dir="left" width={14} height={14} />
            </button>
            {/* по нажатию на год — все годы сеткой: так быстрее уйти на много лет назад */}
            <button
              type="button"
              aria-expanded={!!years}
              onClick={() => setYears(years ? null : { lastYear: Math.min(now.getFullYear(), year + 4) })}
              className="flex items-center gap-1 rounded-control px-3 py-1.5 text-sm text-ink hover:bg-paper-deep"
            >
              {years ? `${years.lastYear - 11}–${years.lastYear}` : year}
              <ChevronIcon dir="right" width={11} height={11} className={`text-ink-faint transition-transform ${years ? "-rotate-90" : "rotate-90"}`} />
            </button>
            <button
              type="button"
              aria-label={years ? "Позже" : "Следующий год"}
              disabled={years ? years.lastYear >= now.getFullYear() : year >= now.getFullYear()}
              onClick={() => (years ? setYears({ lastYear: Math.min(now.getFullYear(), years.lastYear + 12) }) : setYear((y) => y + 1))}
              className="rounded-control p-2 text-ink-soft hover:bg-paper-deep hover:text-ink disabled:opacity-30"
            >
              <ChevronIcon width={14} height={14} />
            </button>
          </div>
          {years && (
            <div className="mt-2 grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, k) => years.lastYear - 11 + k).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setYear(y);
                    setYears(null);
                  }}
                  className={`rounded-control px-1 py-2 text-sm transition-colors ${
                    y === year ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          <div className={`mt-2 grid grid-cols-4 gap-1 ${years ? "hidden" : ""}`} onMouseLeave={() => setHover(null)}>
            {MONTHS.map((name, i) => {
              const m = at(year, i + 1);
              const edge = m === lo || m === hi;
              const inside = m > lo && m < hi;
              return (
                <button
                  key={name}
                  type="button"
                  disabled={m > nowAt}
                  onClick={() => choose(i + 1)}
                  onMouseEnter={() => setHover(m)}
                  className={`rounded-control px-1 py-2 text-sm transition-colors disabled:opacity-30 ${
                    edge ? "bg-ink text-paper" : inside ? "bg-paper-edge text-ink" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-xs text-ink-faint">
            {years ? "Выберите год" : start ? "Если снимали дольше, выберите последний месяц" : "Выберите месяц съёмки"}
          </p>
        </div>
      )}
    </div>
  );
}
