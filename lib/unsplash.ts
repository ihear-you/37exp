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

/** Пусто, если ключа нет или Unsplash недоступен — вызывающий код подставит локальные кадры.
 * Пул 20, а не 30: на первом экране плитки берут ~12 разных кадров, а за первые секунды после
 * первой смены в плитки попадает почти весь пул — лишние кадры только грузят канал. */
export async function getEditorialPhotos(perQuery = 20): Promise<EditorialPhoto[]> {
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
      // размытие. 1200 — компромисс с весом: в покое хватает с большим запасом, а в самом
      // конце разгона на Retina-ноутбуке кадр растянут примерно вдвое, но к этому моменту он
      // уже уходит в прозрачность. Замер: w=1600 — 169 КБ в среднем, w=1200 — ~97 КБ.
      src: `${p.urls.raw}&w=1200&q=70&fm=jpg&fit=max`,
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
