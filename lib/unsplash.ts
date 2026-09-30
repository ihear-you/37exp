// Фото для WelcomeReel (см. app/components/WelcomeReel.tsx), когда лента пуста.
// Серверный запрос: ключ не должен попасть в клиентский бандл.

// Несколько тем вместо одной — нужна разномастная подборка (город, архитектура, природа,
// вода, горы, люди), а не только уличная съёмка.
const QUERIES = ["night city street", "architecture minimal", "mountains nature water", "urban life people", "cars road"];

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
    { headers: { Authorization: `Client-ID ${key}` }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { results: UnsplashPhoto[] };
  return data.results;
}

/** Пусто, если ключа нет или Unsplash недоступен — вызывающий код подставит локальные кадры */
export async function getEditorialPhotos(perQuery = 7): Promise<EditorialPhoto[]> {
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
      src: `${p.urls.raw}&w=900&q=80&fm=jpg&fit=max`,
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
