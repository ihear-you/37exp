/** Факты о плёнке «островом» внизу экрана: лежит поверх кадров и не уходит при прокрутке.
    Ниже md внизу уже есть бар навигации (BottomBarNav, h-16), поэтому остров стоит над ним.
    На телефоне факты идут одной строкой и листаются вбок: остров остаётся низким */
export default function RollIsland({ facts }: { facts: [string, string][] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-3 md:bottom-5">
      <div className="pointer-events-auto max-w-full rounded-[20px] bg-paper-light/80 px-5 py-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <dl className="no-scrollbar flex gap-x-8 overflow-x-auto">
          {facts.map(([k, v]) => (
            <div key={k} className="shrink-0">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">{k}</dt>
              <dd className="mt-0.5 whitespace-nowrap text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
