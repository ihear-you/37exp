// Типы, справочник плёнок и подписи. Сами плёнки, камеры и кадры лежат в базе (lib/db/),
// а ROLLS, CAMERAS и FRAMES ниже — стартовые данные: из них база заполняется при первом запуске
// (lib/db/seed.ts), и ещё их пока читают прототип загрузки и пустая лента.
// Страницы ленты, папок и плёнки берут данные из lib/db, а не отсюда.

import framesJson from "./photos/frames.json";

export type Format = "35" | "120";

export interface Film {
  id: string;
  name: string;
  /** Пояснение в списке выбора, в название папки не попадает */
  note?: string;
  /** Заявленная на плёнке чувствительность */
  iso: number | null;
  bw?: boolean;
  /** Написания без пробелов и знаков, по ним разбираются названия папок */
  synonyms: string[];
}

/**
 * Кто видит плёнку: только автор или любой по ссылке со своим ключом. "public" (плёнка ещё и на странице автора /u/…)
 * больше не выбирается: миграция 11 перевела такие плёнки в "link"; значение осталось в базе и в правилах доступа
 */
export type Visibility = "private" | "link" | "public";

/** short: подпись на кнопке доступа; label и hint: в списке выбора */
export const VISIBILITIES: { id: Visibility; short: string; label: string; hint: string }[] = [
  { id: "private", short: "Только я", label: "Только я", hint: "Плёнку видите только вы" },
  { id: "link", short: "По ссылке", label: "Все, у кого есть ссылка", hint: "Откроет любой, кому вы отправите ссылку" },
];

export interface Camera {
  id: string;
  name: string;
}

export interface Roll {
  id: number;
  filmId: string;
  format: Format;
  /** ISO, на котором снимали (может отличаться от заявленного) */
  iso: number | null;
  cameraId: string;
  year: number;
  month: number;
  /** Конец периода съёмки, если плёнку снимали дольше месяца; иначе нет */
  endYear?: number | null;
  endMonth?: number | null;
  description: string;
  /** Своё название; без него название собирается из плёнки, даты и ISO */
  title?: string | null;
  /** Без значения считается «только я» */
  visibility?: Visibility;
  /** Ключ для ссылки; приходит на клиент только к автору плёнки */
  shareKey?: string;
}

/** Правка плёнки из формы «Изменить» */
export interface RollEdit {
  title: string | null;
  description: string;
  filmId: string;
  cameraId: string;
  iso: number | null;
  format: Format;
  month: number;
  year: number;
  /** Конец периода съёмки; null — сняли за один месяц */
  endMonth: number | null;
  endYear: number | null;
}

export interface Frame {
  id: string;
  roll: number;
  idx: number;
  w: number;
  h: number;
  hue: number;
  sat: number;
  light: number;
  color: string;
  /** Оригинал на сервере есть и его можно скачать (/photos/o/<id>); у стартового набора и временных кадров его нет */
  original?: boolean;
  /** Версия картинки (растёт при повороте): попадает в адрес копий, чтобы браузер не показал старую из памяти */
  v?: number;
}

export const UNKNOWN_FILM = "unknown";

export const FILMS: Film[] = [
  { id: UNKNOWN_FILM, name: "Не знаю / не указана", iso: null, synonyms: [] },
  { id: "kodak-color-plus-200", name: "Kodak Color Plus 200", iso: 200, synonyms: ["kodakcolorplus200", "kodakcolorplus", "colorplus200", "colorplus", "kodakcolor200", "kodakcolor"] },
  { id: "kodak-gold-200", name: "Kodak Gold 200", iso: 200, synonyms: ["kodakgold200", "kodakgold", "gold200"] },
  { id: "lucky-color-200", name: "Lucky Color 200", iso: 200, synonyms: ["luckycolor200", "luckycolor", "lucky200", "lucky"] },
  { id: "perspectiva-super-f-200", name: "Perspectiva Super-F 200", iso: 200, synonyms: ["perspectivasuperf200", "perspectivasuperf", "perspectiva", "superf200"] },
  { id: "tasma-t-42l", name: "Tasma T-42L", iso: null, bw: true, synonyms: ["tasmat42l", "tasma42l", "t42l", "тасма"] },
  { id: "luch", name: "«Луч»", note: "цветная", iso: 200, synonyms: ["луч", "лучцветная", "luch"] },
  { id: "dva-lucha-400", name: "«Два луча» 400", iso: 400, synonyms: ["двалуча400", "двалуча", "2луча400", "2луча"] },
  { id: "kodak-portra-160", name: "Kodak Portra 160", iso: 160, synonyms: ["kodakportra160", "portra160"] },
  { id: "kodak-portra-400", name: "Kodak Portra 400", iso: 400, synonyms: ["kodakportra400", "portra400"] },
  { id: "kodak-portra-800", name: "Kodak Portra 800", iso: 800, synonyms: ["kodakportra800", "portra800"] },
  { id: "kodak-ultramax-400", name: "Kodak Ultramax 400", iso: 400, synonyms: ["kodakultramax400", "kodakultramax", "ultramax400", "ultramax"] },
  { id: "fujifilm-c200", name: "Fujifilm C200", iso: 200, synonyms: ["fujifilmc200", "fujic200", "fujicolorc200", "c200"] },
  { id: "fujifilm-superia-400", name: "Fujifilm Superia X-Tra 400", iso: 400, synonyms: ["superiaxtra400", "superiaxtra", "superia400", "superia"] },
  { id: "agfa-vista-200", name: "Agfa Vista 200", iso: 200, synonyms: ["agfavista200", "agfavista", "vista200"] },
  { id: "ilford-hp5-400", name: "Ilford HP5 Plus 400", iso: 400, bw: true, synonyms: ["ilfordhp5plus400", "hp5plus400", "hp5plus", "ilfordhp5", "hp5"] },
  { id: "kodak-tri-x-400", name: "Kodak Tri-X 400", iso: 400, bw: true, synonyms: ["kodaktrix400", "kodaktrix", "trix400", "trix"] },
  { id: "cinestill-800t", name: "CineStill 800T", iso: 800, synonyms: ["cinestill800t", "cinestill800", "800t"] },
];

export const CAMERAS: Camera[] = [{ id: "pentax-155g", name: "Pentax 155g" }];

export const ISO_VALUES = [25, 50, 100, 160, 200, 250, 400, 500, 800, 1600, 3200];

export const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export const ROLLS: Roll[] = [
  { id: 1, filmId: "lucky-color-200", format: "35", iso: 200, cameraId: "pentax-155g", year: 2026, month: 4, description: "Корея, 1–15 апреля." },
  { id: 2, filmId: "tasma-t-42l", format: "35", iso: null, cameraId: "pentax-155g", year: 2026, month: 7, description: "" },
];

export const FRAMES = framesJson as Frame[];

// ── названия и подписи ──

/** films: справочник плюс свои плёнки пользователя */
export const findFilm = (id: string, films: readonly Film[] = FILMS) => films.find((f) => f.id === id) ?? FILMS[0];

export function filmLabel(f: Film) {
  return f.note ? `${f.name} (${f.note})` : f.name;
}

/** Когда снимали: месяц с годом и, если плёнку снимали дольше, конец периода */
export interface Period {
  year: number;
  month: number;
  endYear?: number | null;
  endMonth?: number | null;
}

/** «июль 2025», «июль–август 2025», «декабрь 2025 – январь 2026». capital: с заглавной, когда строка с неё начинается */
export function periodLabel(p: Period, capital = false) {
  const start = MONTHS[p.month - 1];
  const end = p.endYear && p.endMonth && rollDate({ year: p.endYear, month: p.endMonth }) > rollDate(p) ? { year: p.endYear, month: p.endMonth } : null;
  const label = !end
    ? `${start} ${p.year}`
    : end.year === p.year
      ? `${start}–${MONTHS[end.month - 1]} ${p.year}`
      : `${start} ${p.year} – ${MONTHS[end.month - 1]} ${end.year}`;
  return capital ? label.replace(/^./, (c) => c.toUpperCase()) : label;
}

/** «Kodak Gold 200 · июль 2025». Если ISO съёмки не совпал с заявленным, оно дописывается */
export function makeTitle(film: Film, period: Period, iso: number | null) {
  const name = film.id === UNKNOWN_FILM ? "Плёнка не указана" : film.name;
  const parts = [name, periodLabel(period)];
  if (film.iso && iso && film.iso !== iso) parts.push(`ISO ${iso}`);
  return parts.join(" · ");
}

export function rollTitle(r: Roll, films: readonly Film[] = FILMS) {
  return r.title || makeTitle(findFilm(r.filmId, films), r, r.iso);
}

export const formatLabel = (f: Format) => (f === "35" ? "35 мм" : "120, средний формат");

/** Для сортировки по дате */
export const rollDate = (r: { year: number; month: number }) => r.year * 12 + r.month;

const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Проверка периода с клиента: начало обязательно, конец — оба поля или ни одного, и не раньше начала */
export function validPeriod(p: { month: unknown; year: unknown; endMonth: unknown; endYear: unknown }) {
  if (!isInt(p.month, 1, 12) || !isInt(p.year, 1900, 2200)) return false;
  if (p.endMonth === null && p.endYear === null) return true;
  return (
    isInt(p.endMonth, 1, 12) &&
    isInt(p.endYear, 1900, 2200) &&
    rollDate({ year: p.endYear as number, month: p.endMonth as number }) >= rollDate({ year: p.year as number, month: p.month as number })
  );
}

/** v — версия картинки (Frame.v): после поворота адрес другой, и браузер берёт новую копию, а не старую из памяти */
export const feedSrc = (id: string, v?: number) => `/photos/f/${id}.jpg${v ? `?v=${v}` : ""}`;
export const fullSrc = (id: string, v?: number) => `/photos/l/${id}.jpg${v ? `?v=${v}` : ""}`;

/** Всё, что нужно клиентским компонентам про плёнку (без лишнего) */
export interface RollView {
  id: number;
  title: string;
  film: string;
  camera: string;
  cameraId: string;
  filmId: string;
  iso: number | null;
  format: Format;
  year: number;
  month: number;
  endYear: number | null;
  endMonth: number | null;
  description: string;
  count: number;
}

export function rollView(r: Roll, cameras: readonly Camera[], count: number, films: readonly Film[] = FILMS): RollView {
  const film = findFilm(r.filmId, films);
  return {
    id: r.id,
    title: rollTitle(r, films),
    film: film.id === UNKNOWN_FILM ? "Плёнка не указана" : film.name,
    camera: cameras.find((c) => c.id === r.cameraId)?.name ?? "",
    cameraId: r.cameraId,
    filmId: r.filmId,
    iso: r.iso,
    format: r.format,
    year: r.year,
    month: r.month,
    endYear: r.endYear ?? null,
    endMonth: r.endMonth ?? null,
    description: r.description,
    count,
  };
}
