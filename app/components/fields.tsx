export const control =
  "w-full rounded-control bg-paper-light px-3 py-2.5 text-base ring-1 ring-line transition-shadow focus:outline-none focus:ring-2 focus:ring-ink/50 md:py-2 md:text-sm";

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

/** Подпись над полем (мелкими заглавными) и пояснение под ним */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-ink-faint">{label}</span>
      <label className="block">{children}</label>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Период съёмки: endMonth и endYear — null, если плёнку сняли за один месяц */
export interface PeriodValue {
  month: number;
  year: number;
  endMonth: number | null;
  endYear: number | null;
}
