// Фото для WelcomeReel (см. app/components/WelcomeReel.tsx), когда лента пуста.
// Серверный запрос: ключ не должен попасть в клиентский бандл.

// Motion blur — тематически в точку для WelcomeReel: кадры и так постоянно летят и
// разгоняются, смазанные в движении фото только усиливают этот эффект. Один запрос, а не
// несколько: демо-ключ Unsplash даёт всего 50 запросов в час, и их легко исчерпать за
// разработку — а кэш ниже (сутки, не час) держит их подольше.
const QUERIES = ["motion blur"];

export interface EditorialPhoto {
  id: string;
  src: string;
  w: number;
  h: number;
  color: string;
  alt: string;
  credit: { name: string; url: string };
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  color: string | null;
  alt_description: string | null;
  urls: { raw: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

async function searchQuery(query: string, key: string, perPage: number): Promise<UnsplashPhoto[]> {
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${key}` }, next: { revalidate: 86400 } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { results: UnsplashPhoto[] };
  return data.results;
}

async function loadEditorialPhotos(perQuery: number): Promise<EditorialPhoto[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];

  try {
    const batches = await Promise.all(QUERIES.map((q) => searchQuery(q, key, perQuery)));
    const seen = new Set<string>();
    const photos = batches.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    if (photos.length === 0) return [];

    // Обязательное условие API Unsplash: засчитать показ как «использование» фото
    void Promise.allSettled(
      photos.map((p) => fetch(p.links.download_location, { headers: { Authorization: `Client-ID ${key}` } })),
    );

    return photos.map((p) => ({
      id: p.id,
      // Крупнее, чем нужно для показа в покое: плитки в WelcomeReel разгоняются в несколько
      // раз через CSS scale(), и при недостаточном разрешении исходника это выглядит как
      // размытие — источник должен быть с запасом на самый большой момент разгона.
      src: `${p.urls.raw}&w=1600&q=80&fm=jpg&fit=max`,
      w: p.width,
      h: p.height,
      color: p.color ?? "#d9d9d9",
      alt: p.alt_description ?? "",
      credit: { name: p.user.name, url: `${p.user.links.html}?utm_source=photo-lab&utm_medium=referral` },
    }));
  } catch {
    return [];
  }
}

// Результат держим в памяти процесса: без этого каждый заход на главную заново слал бы в Unsplash
// запрос «засчитать показ» на каждое из 30 фото (медленно и быстро съедает лимит 50 запросов в час).
const OK_TTL = 24 * 60 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000; // пусто (ошибка или лимит): пробуем снова не чаще раза в 5 минут
let cached: { at: number; ttl: number; perQuery: number; photos: EditorialPhoto[] } | null = null;
let inflight: Promise<EditorialPhoto[]> | null = null;

/** Пусто, если ключа нет или Unsplash недоступен — вызывающий код подставит запасной вариант */
export async function getEditorialPhotos(perQuery = 30): Promise<EditorialPhoto[]> {
  if (!process.env.UNSPLASH_ACCESS_KEY) return [];
  if (cached && cached.perQuery === perQuery && Date.now() - cached.at < cached.ttl) return cached.photos;
  inflight ??= loadEditorialPhotos(perQuery)
    .then((photos) => {
      cached = { at: Date.now(), ttl: photos.length ? OK_TTL : FAIL_TTL, perQuery, photos };
      return photos;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
