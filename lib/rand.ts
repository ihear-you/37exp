// Случайность с зерном: один и тот же seed даёт один и тот же порядок.

export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Случайный порядок, устойчивый к удалению: место каждого элемента зависит только от его ключа и зерна,
 * поэтому если убрать один элемент, остальные не перетасовываются (у shuffled порядок зависит от длины списка)
 */
export function shuffledBy<T>(list: readonly T[], seed: number, key: (item: T) => string): T[] {
  const rank = (s: string) => {
    let h = (seed ^ 0x811c9dc5) >>> 0; // FNV-1a по ключу, затем перемешивание mulberry32
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return mulberry32(h)();
  };
  return list
    .map((item) => ({ item, k: key(item), r: rank(key(item)) }))
    .sort((a, b) => a.r - b.r || (a.k < b.k ? -1 : 1))
    .map((x) => x.item);
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
