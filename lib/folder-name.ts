// Подсказка по названию папки: «KodakGold200_июль2025» → плёнка, ISO, месяц и год.
// Это только подсказка для предзаполнения формы, всё проверяется и правится вручную.

import { ISO_VALUES, type Film } from "./catalog";

export interface FolderGuess {
  filmId?: string;
  iso?: number;
  year?: number;
  month?: number;
}

const MONTH_WORDS: [RegExp, number][] = [
  [/янв|\bjan/, 1],
  [/фев|\bfeb/, 2],
  [/мар|\bmar/, 3],
  [/апр|\bapr/, 4],
  [/ма[йя]|\bmay/, 5],
  [/июн|\bjun/, 6],
  [/июл|\bjul/, 7],
  [/авг|\baug/, 8],
  [/сен|\bsep/, 9],
  [/окт|\boct/, 10],
  [/ноя|\bnov/, 11],
  [/дек|\bdec/, 12],
];

export function parseFolderName(name: string, films: readonly Film[]): FolderGuess {
  const lower = name.toLowerCase().replace(/ё/g, "е");
  const squashed = lower.replace(/[^a-z0-9а-я]/g, "");
  const guess: FolderGuess = {};

  // плёнка: ищем самое длинное совпавшее написание (Lucky200 = Lucky Color 200)
  let bestLen = 0;
  for (const film of films) {
    for (const syn of film.synonyms) {
      if (syn.length > bestLen && squashed.includes(syn)) {
        bestLen = syn.length;
        guess.filmId = film.id;
      }
    }
  }

  // год и месяц
  const numeric =
    lower.match(/(?<!\d)(0?[1-9]|1[0-2])[.\-_ ](20\d{2})(?!\d)/) ??
    lower.match(/(?<!\d)(20\d{2})[.\-_ ](0[1-9]|1[0-2])(?!\d)/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    guess.year = a > 31 ? a : b;
    guess.month = a > 31 ? b : a;
  } else {
    const year = lower.match(/(?<!\d)(20\d{2})(?!\d)/);
    if (year) guess.year = Number(year[1]);
    const word = MONTH_WORDS.find(([re]) => re.test(lower));
    if (word) guess.month = word[1];
  }

  // ISO: явное «iso400», иначе число из списка, иначе заявленное на найденной плёнке
  const explicit = lower.match(/iso[\s_-]?(\d{2,4})/);
  if (explicit && ISO_VALUES.includes(Number(explicit[1]))) {
    guess.iso = Number(explicit[1]);
  } else if (guess.filmId) {
    guess.iso = films.find((f) => f.id === guess.filmId)?.iso ?? undefined;
  } else {
    const loose = lower.match(new RegExp(`(?<!\\d)(${ISO_VALUES.join("|")})(?!\\d)`));
    if (loose) guess.iso = Number(loose[1]);
  }

  return guess;
}
