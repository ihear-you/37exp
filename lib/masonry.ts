// Masonry без обрезки: высота клетки всегда следует пропорции кадра.
//
// Крупный кадр занимает несколько соседних колонок (span 2 или 3) и не должен оставлять под собой дыру.
// Поэтому он остаётся крупным, только если найдётся окно колонок с почти ровным верхом.
// Если его нет, в подходящую колонку окна сначала «подтягиваются» ближайшие узкие кадры (до трёх);
// и только когда и это не помогает, кадр становится на размер меньше: три колонки, две, одна.
//
// Низ ленты выравнивается отдельно: порядок последних кадров перебирается так, чтобы колонки
// заканчивались на близкой высоте (кадры не пропадают, меняется только порядок хвоста).

import { mulberry32 } from "./rand";

export interface MItem {
  key: string;
  ratio: number;
  span: 1 | 2 | 3;
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
  /** Сколько последних кадров переставляем (и при нужде уменьшаем крупные), чтобы выровнять низ колонок */
  tail?: number;
  /** Сколько вариантов порядка хвоста пробуем */
  tries?: number;
}

interface State<T> {
  tops: number[];
  placed: Placed<T>[];
}

type Span = 1 | 2 | 3;

export function layoutMasonry<T extends MItem>(items: readonly T[], o: Options) {
  const { cols, width, gap, lookahead = 12, tail = 16, tries = 300 } = o;
  const colW = (width - gap * (cols - 1)) / cols;

  const widthOf = (span: Span) => span * colW + (span - 1) * gap;
  const heightOf = (it: T, span: Span) => widthOf(span) / it.ratio;

  const tolerance = colW * 0.15; // такую разницу в верхах окна не замечаем
  const maxGap = colW * 0.25; // лишняя пустота под крупным кадром не больше этой

  const spread = (list: number[]) => Math.max(...list) - Math.min(...list);

  // Раскладывает очередь поверх уже занятого состояния и возвращает новое
  const run = (order: readonly T[], from: State<T>): State<T> => {
    const tops = [...from.tops]; // следующий свободный y в колонке
    const placed = [...from.placed];
    const queue = [...order];
    const shortest = () => tops.indexOf(Math.min(...tops));

    const put = (item: T, span: Span, col: number, y: number) => {
      const h = heightOf(item, span);
      placed.push({ item, x: col * (colW + gap), y, w: widthOf(span), h });
      for (let c = col; c < col + span; c++) tops[c] = y + h + gap;
    };

    while (queue.length) {
      const it = queue[0];
      const span = Math.min(it.span, cols) as Span;

      if (span === 1) {
        queue.shift();
        const c = shortest();
        put(it, 1, c, tops[c]);
        continue;
      }

      // крупный: ищем окно из span соседних колонок с самым ровным верхом
      let start = 0;
      let best = Infinity;
      for (let c = 0; c + span <= cols; c++) {
        const d = spread(tops.slice(c, c + span));
        if (d < best - 1e-6) {
          best = d;
          start = c;
        }
      }
      const win = tops.slice(start, start + span);

      if (best > tolerance) {
        // пробуем выровнять окно: подтягиваем в одну из его колонок один-три ближайших узких кадра
        const cands: { idx: number; h: number }[] = [];
        for (let j = 1; j < Math.min(queue.length, lookahead + 1); j++) {
          if (queue[j].span === 1) cands.push({ idx: j, h: heightOf(queue[j], 1) + gap });
        }
        let bestSet: number[] = [];
        let bestCol = start;
        let bestScore = best - tolerance / 2; // берём только заметное улучшение
        const consider = (set: number[], sum: number) => {
          for (let k = 0; k < span; k++) {
            const score = spread(win.map((t, m) => (m === k ? t + sum : t)));
            if (score < bestScore) {
              bestScore = score;
              bestSet = set;
              bestCol = start + k;
            }
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
          for (const cand of picked) put(cand, 1, bestCol, tops[bestCol]);
          continue;
        }

        if (best > maxGap) {
          // ровного окна нет: кадр становится на размер меньше и пробует снова
          queue[0] = { ...it, span: span - 1 } as T;
          continue;
        }
      }

      queue.shift();
      put(it, span, start, Math.max(...win));
    }


    return { tops, placed };
  };

  // Низ ленты: перебираем порядок последних кадров, оставляем тот, где колонки кончаются ровнее всего
  const empty: State<T> = { tops: new Array(cols).fill(0), placed: [] };
  const cut = Math.max(0, items.length - tail);
  const head = run(items.slice(0, cut), empty);
  const tailItems = items.slice(cut);
  let best = run(tailItems, head);

  if (tailItems.length > 1) {
    const rnd = mulberry32(items.length * 7919 + cols);
    for (let t = 0; t < tries && spread(best.tops) > colW * 0.1; t++) {
      const order = [...tailItems];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      // крупные кадры в самом конце сильнее всего рвут низ: часть из них пробуем обычного размера
      for (let i = 0; i < order.length; i++) {
        if (order[i].span > 1 && rnd() < 0.5) order[i] = { ...order[i], span: 1 };
      }
      const cand = run(order, head);
      if (spread(cand.tops) < spread(best.tops) - 1e-6) best = cand;
    }
  }

  const height = Math.max(0, Math.max(...best.tops) - gap);
  return { placed: best.placed, height, colW };
}
