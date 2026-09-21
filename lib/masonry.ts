// Masonry без обрезки: высота клетки всегда следует пропорции кадра.
//
// Широкий кадр (span 2) ложится на пару соседних колонок и не должен оставлять под собой дыру.
// Поэтому он остаётся широким, только если найдётся пара колонок с почти ровным верхом.
// Если её нет, в более короткую колонку сначала «подтягиваются» ближайшие узкие кадры (до трёх);
// и только когда и это не помогает, кадр становится обычным узким.

export interface MItem {
  key: string;
  ratio: number;
  span: 1 | 2;
}

export interface Placed<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Options {
  cols: number;
  width: number;
  gap: number;
  /** Сколько следующих кадров просматриваем в поисках подходящих по высоте */
  lookahead?: number;
}

export function layoutMasonry<T extends MItem>(items: readonly T[], o: Options) {
  const { cols, width, gap, lookahead = 12 } = o;
  const colW = (width - gap * (cols - 1)) / cols;
  const tops: number[] = new Array(cols).fill(0); // следующий свободный y в колонке
  const placed: Placed<T>[] = [];
  const queue = [...items];

  const heightOf = (it: T, span: 1 | 2) => (span === 2 ? colW * 2 + gap : colW) / it.ratio;
  const shortest = () => tops.indexOf(Math.min(...tops));

  const put = (item: T, span: 1 | 2, col: number, y: number) => {
    const w = span === 2 ? colW * 2 + gap : colW;
    const h = heightOf(item, span);
    placed.push({ item, x: col * (colW + gap), y, w, h });
    for (let c = col; c < col + span; c++) tops[c] = y + h + gap;
  };

  const tolerance = colW * 0.15; // такую разницу в верхах пары не замечаем
  const maxGap = colW * 0.25; // лишняя пустота под широким кадром не больше этой

  while (queue.length) {
    const it = queue[0];

    if (it.span === 1 || cols < 2) {
      queue.shift();
      const c = shortest();
      put(it, 1, c, tops[c]);
      continue;
    }

    // широкий: ищем пару соседних колонок с самым ровным верхом
    let pair = 0;
    let diff = Infinity;
    for (let c = 0; c < cols - 1; c++) {
      const d = Math.abs(tops[c] - tops[c + 1]);
      if (d < diff - 1e-6) {
        diff = d;
        pair = c;
      }
    }
    const low = tops[pair] <= tops[pair + 1] ? pair : pair + 1; // короткая колонка пары

    if (diff > tolerance) {
      // пробуем выровнять пару: подтягиваем в короткую колонку один-три ближайших узких кадра
      const cands: { idx: number; h: number }[] = [];
      for (let j = 1; j < Math.min(queue.length, lookahead + 1); j++) {
        if (queue[j].span === 1) cands.push({ idx: j, h: heightOf(queue[j], 1) + gap });
      }
      let bestSet: number[] = [];
      let bestScore = diff - tolerance / 2; // берём только заметное улучшение
      const consider = (set: number[], sum: number) => {
        const score = Math.abs(diff - sum);
        if (score < bestScore) {
          bestScore = score;
          bestSet = set;
        }
      };
      for (let a = 0; a < cands.length; a++) {
        consider([cands[a].idx], cands[a].h);
        for (let b = a + 1; b < cands.length; b++) {
          consider([cands[a].idx, cands[b].idx], cands[a].h + cands[b].h);
          for (let c = b + 1; c < cands.length; c++) {
            consider([cands[a].idx, cands[b].idx, cands[c].idx], cands[a].h + cands[b].h + cands[c].h);
          }
        }
      }
      if (bestSet.length) {
        const picked = bestSet.map((i) => queue[i]);
        for (const i of [...bestSet].sort((p, q) => q - p)) queue.splice(i, 1);
        for (const cand of picked) put(cand, 1, low, tops[low]);
        continue;
      }

      if (diff > maxGap) {
        // ровной пары нет: кадр остаётся узким
        queue.shift();
        const narrow = { ...it, span: 1 } as T;
        const c = shortest();
        put(narrow, 1, c, tops[c]);
        continue;
      }
    }

    queue.shift();
    put(it, 2, pair, Math.max(tops[pair], tops[pair + 1]));
  }

  const height = Math.max(0, Math.max(...tops) - gap);
  return { placed, height, colW };
}
