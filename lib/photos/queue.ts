import { log } from "../log";

// Очередь на тяжёлую работу с картинками (копии для ленты и просмотра, поворот) на весь сервер. На сервере один
// процессор и служба с пределом памяти 700 МБ, а кадры приходят отовсюду сразу: загрузки с устройств, импорт
// с Диска, повороты. Без очереди несколько крупных TIFF одновременно могли занять всю память, и служба падала
// вместе с чужими загрузками. Остальные ждут своей очереди по порядку прихода.
// PHOTO_JOBS — сколько работ идёт одновременно (по умолчанию одна).

const LIMIT = Math.max(1, Number(process.env.PHOTO_JOBS) || 1);

interface Queue {
  running: number;
  waiting: (() => void)[];
}

// в dev модуль перезагружается при правках: очередь одна на процесс
const g = globalThis as typeof globalThis & { __plenkaPhotoQueue?: Queue };
const queue = (g.__plenkaPhotoQueue ??= { running: 0, waiting: [] });

/** Выполняет work, когда до неё дойдёт очередь. Внутри work не вызывать withPhotoSlot ещё раз: будет ждать сама себя */
export async function withPhotoSlot<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (queue.running >= LIMIT) {
    const ahead = queue.waiting.length + queue.running;
    const start = Date.now();
    await new Promise<void>((resolve) => queue.waiting.push(resolve));
    log("ingest", `${label}: ждал очереди на обработку ${Date.now() - start} мс (впереди было ${ahead})`);
  } else {
    queue.running++;
  }
  try {
    return await work();
  } finally {
    // место переходит следующему в очереди; если никого нет — освобождается
    const next = queue.waiting.shift();
    if (next) next();
    else queue.running--;
  }
}
