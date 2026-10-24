import { MONTHS } from "@/lib/catalog";

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

const at = (year: number, month: number) => year * 12 + month;

/**
 * Начало и конец съёмки, месяц с годом. Конец по умолчанию совпадает с началом (плёнку сняли за месяц);
 * раньше начала он не бывает: сдвинули начало дальше конца — конец едет следом
 */
export function PeriodFields({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const endMonth = value.endMonth ?? value.month;
  const endYear = value.endYear ?? value.year;
  const thisYear = new Date().getFullYear();
  const years = [...new Set([...Array.from({ length: 15 }, (_, i) => thisYear - i), value.year, endYear])].sort((a, b) => b - a);

  const set = (month: number, year: number, eMonth: number, eYear: number) => {
    if (at(eYear, eMonth) < at(year, month)) [eMonth, eYear] = [month, year];
    const same = at(eYear, eMonth) === at(year, month);
    onChange({ month, year, endMonth: same ? null : eMonth, endYear: same ? null : eYear });
  };

  const row = (label: string, m: number, y: number, put: (m: number, y: number) => void) => (
    <Field label={label}>
      <span className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
        <Select value={m} aria-label={`${label}: месяц`} onChange={(e) => put(Number(e.target.value), y)}>
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <Select value={y} aria-label={`${label}: год`} onChange={(e) => put(m, Number(e.target.value))}>
          {years.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </span>
    </Field>
  );

  return (
    <>
      {/* пока конца нет, он идёт за началом */}
      {row("Начало съёмки", value.month, value.year, (m, y) => (value.endMonth === null ? set(m, y, m, y) : set(m, y, endMonth, endYear)))}
      {row("Конец съёмки", endMonth, endYear, (m, y) => set(value.month, value.year, m, y))}
    </>
  );
}
