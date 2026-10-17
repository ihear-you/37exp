// Заготовки страниц на время перехода (loading.tsx): показываются сразу после клика, пока не пришли данные.
// Next подгружает их заранее, поэтому они появляются мгновенно даже во время загрузки фото, когда канал занят.
// Пропорции плиток заданы заранее, а не случайно: сервер и браузер рисуют одно и то же.

const tile = "animate-pulse rounded-frame bg-paper-deep";
const RATIOS = ["aspect-[3/2]", "aspect-[2/3]", "aspect-[3/2]", "aspect-[3/2]", "aspect-[2/3]", "aspect-[3/2]", "aspect-[2/3]", "aspect-[3/2]"];

/** Сетка кадров: 2 колонки на телефоне, 4 от md, как у ленты (Masonry.tsx) */
function FramesSkeleton() {
  return (
    <div className="columns-2 gap-3 md:columns-4 md:gap-4">
      {[...RATIOS, ...RATIOS].map((ratio, i) => (
        <div key={i} className={`${tile} ${ratio} mb-3 break-inside-avoid md:mb-4`} />
      ))}
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-16 pt-4 md:px-5 md:pt-5" aria-busy="true" aria-label="Лента загружается">
      <FramesSkeleton />
    </div>
  );
}

export function RollsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 md:px-5" aria-busy="true" aria-label="Папки загружаются">
      <div className="flex gap-2 py-2.5">
        {[64, 48, 64].map((w, i) => (
          <div key={i} className="h-8 animate-pulse rounded-control bg-paper-deep" style={{ width: w + 16 }} />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-3 pb-16 pt-4 sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="rounded-[20px] bg-paper-light p-5 shadow-[var(--card-ring)]">
            <div className="aspect-[2/1] w-full animate-pulse rounded-[14px] bg-paper-deep" />
            <div className="mx-auto mt-6 h-4 w-2/3 animate-pulse rounded bg-paper-deep" />
            <div className="mx-auto mt-2 h-3 w-1/3 animate-pulse rounded bg-paper-deep" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RollSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-40 md:px-5" aria-busy="true" aria-label="Папка загружается">
      <div className="pb-6 pt-6 md:pt-8">
        <div className="h-4 w-24 animate-pulse rounded bg-paper-deep" />
        <div className="mt-4 h-8 w-2/3 max-w-xl animate-pulse rounded bg-paper-deep md:h-10" />
      </div>
      <FramesSkeleton />
    </div>
  );
}
