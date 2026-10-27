"use client";

import { useEffect, useRef, useState } from "react";

/** Описание папки под названием. Три строки видны сразу; если текст длиннее, под ним «Развернуть» */
export default function RollDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  // обрезан ли текст тремя строками; меряем только в свёрнутом виде, пересчитываем при смене ширины
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  return (
    // отступ подобран так, чтобы видимое расстояние до описания совпало с расстоянием от заголовка до строки
    // с данными плёнки (RollDetail.tsx): у строк разная высота, поэтому одинаковые mt дали бы разные просветы
    <div className="mt-2 max-w-prose md:mt-[11px]">
      <p ref={ref} className={`text-[15px] leading-relaxed text-ink-soft ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-[11px] uppercase tracking-wider text-ink-faint transition-colors hover:text-ink"
        >
          {expanded ? "Свернуть" : "Развернуть"}
        </button>
      )}
    </div>
  );
}
