export const control =
  "w-full rounded-control bg-paper-light px-3 py-2 text-sm ring-1 ring-line transition-shadow focus:outline-none focus:ring-2 focus:ring-ink/50";

/** Селект со своей стрелкой: иконка отступает от границы, текст не заезжает под неё */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select
        {...props}
        className={`${control} cursor-pointer appearance-none pr-10`}
      />
      <svg
        width={14}
        height={14}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
      >
        <path d="M3.5 6l4.5 4.5L12.5 6" />
      </svg>
    </span>
  );
}
