"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MONTHS, feedSrc, fullSrc, type Frame, type RollView } from "@/lib/catalog";
import { ChevronIcon, CloseIcon, TrashIcon } from "./icons";

interface Props {
  frames: readonly Frame[];
  rolls: Record<number, RollView>;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Если задан, в верхней панели есть «Удалить» (с подтверждением) */
  onDelete?: (id: string) => void;
}

/** Кадр на весь экран: стрелки, клавиши и свайп; подпись с камерой, плёнкой, ISO и ссылкой на папку */
export default function Lightbox({ frames, rolls, index, onIndex, onClose, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  // после удаления последнего кадра списка индекс может выйти за край, пока родитель не обновился
  const frame = frames[Math.min(index, frames.length - 1)];
  const roll = frame ? rolls[frame.roll] : undefined;
  const dialog = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const last = frames.length - 1;
  const go = (d: number) => onIndex(Math.min(last, Math.max(0, index + d)));

  // клавиши и блокировка прокрутки страницы
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex(Math.min(last, index + 1));
      else if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, onClose, onIndex]);

  // соседние кадры подгружаются заранее
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      if (frames[i]) new Image().src = fullSrc(frames[i].id);
    }
  }, [index, frames]);

  const remove = () => {
    if (!onDelete || !frame) return;
    setConfirming(false);
    onDelete(frame.id);
    // на месте удалённого встаёт следующий кадр, а если он был последним, то предыдущий
    if (frames.length <= 1) onClose();
    else onIndex(Math.min(index, frames.length - 2));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    touch.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  };

  if (!frame || !roll) return null;

  const info = `${roll.film} · ${MONTHS[roll.month - 1]} ${roll.year}`;

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Кадр ${index + 1} из ${frames.length}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-paper outline-none"
      style={{ animation: "fade-in .18s ease-out" }}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-3 md:px-5">
        <span className="text-sm tabular-nums text-ink-faint">
          {index + 1} / {frames.length}
        </span>
        <div className="flex items-center gap-1">
          {onDelete &&
            (confirming ? (
              <>
                <span className="mr-1 text-sm text-ink-soft">Удалить кадр?</span>
                <button type="button" onClick={remove} className="rounded-control px-3 py-2 text-sm text-accent-vivid transition-colors hover:bg-paper-deep">
                  Да, удалить
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-control px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink">
                  Отмена
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Удалить кадр"
                title="Удалить кадр"
                className="grid size-10 place-items-center rounded-control text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
              >
                <TrashIcon />
              </button>
            ))}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid size-10 place-items-center rounded-control text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 md:px-20"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={frame.id}
          src={fullSrc(frame.id)}
          alt={`${roll.title}, кадр ${frame.idx}`}
          draggable={false}
          className="max-h-full max-w-full select-none bg-cover"
          style={{
            backgroundImage: `url(${feedSrc(frame.id)})`,
            backgroundColor: frame.color,
            boxShadow: "var(--frame-ring-light)",
            animation: "fade-in .2s ease-out",
          }}
        />

        {index > 0 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Предыдущий кадр"
            className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control bg-paper/80 text-ink shadow-sm ring-1 ring-line transition-colors hover:bg-ink hover:text-paper md:left-5"
          >
            <ChevronIcon dir="left" />
          </button>
        )}
        {index < last && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Следующий кадр"
            className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control bg-paper/80 text-ink shadow-sm ring-1 ring-line transition-colors hover:bg-ink hover:text-paper md:right-5"
          >
            <ChevronIcon dir="right" />
          </button>
        )}
      </div>

      <div className="flex shrink-0 justify-center px-4 pb-5 pt-3 text-center">
        <Link
          href={`/rolls/${roll.id}`}
          className="text-sm text-accent-vivid underline decoration-accent-vivid/30 underline-offset-4 transition-colors hover:decoration-accent-vivid"
        >
          {info} · открыть папку
        </Link>
      </div>
    </div>
  );
}
