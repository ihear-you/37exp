"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Frame, RollView } from "@/lib/catalog";
import { MODES, orderFrames, type Mode } from "@/lib/feed";
import { newSeed } from "@/lib/rand";
import { createStore, useStore } from "@/lib/persist";
import Masonry from "./Masonry";
import { ShuffleIcon } from "./icons";

interface Visit {
  seed: number;
  mode: Mode;
}

// Порядок ленты фиксируется один раз за визит (пока открыта вкладка), «Перемешать» меняет его.
const visitStore = createStore<Visit>("plenka:visit", "session", () => ({ seed: newSeed(), mode: "shuffle" }));

export default function Feed({ frames, rolls }: { frames: Frame[]; rolls: Record<number, RollView> }) {
  const visit = useStore(visitStore);
  const seed = visit?.seed ?? 1;
  const mode = visit?.mode ?? "shuffle";

  const ordered = useMemo(() => orderFrames(frames, mode, seed), [frames, mode, seed]);

  // при смене режима или перемешивании возвращаемся к началу ленты
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [mode, seed]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-16 md:px-5">
      <div className="sticky top-14 z-20 -mx-3 flex items-center gap-3 border-b border-line/60 bg-paper/90 px-3 py-2.5 backdrop-blur-md md:-mx-5 md:px-5">
        <div
          className="no-scrollbar -my-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1"
          role="group"
          aria-label="Режим ленты"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => visitStore.set({ mode: m.id })}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                mode === m.id
                  ? "bg-ink text-paper"
                  : "text-ink-soft ring-1 ring-line hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="hidden whitespace-nowrap text-sm tabular-nums text-ink-faint xl:block">{ordered.length} кадров</span>
        <button
          type="button"
          onClick={() => visitStore.set({ seed: newSeed() })}
          disabled={mode === "color"}
          title={mode === "color" ? "В этом режиме кадры идут по цвету" : "Расставить кадры заново"}
          className="flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm text-ink ring-1 ring-ink/40 transition-colors hover:bg-ink hover:text-paper disabled:pointer-events-none disabled:opacity-35"
        >
          <ShuffleIcon width={16} height={16} />
          <span className="hidden sm:inline">Перемешать</span>
        </button>
      </div>

      <div className="pt-4 md:pt-5">
        {visit ? (
          ordered.length ? (
            <Masonry frames={ordered} rolls={rolls} rhythm rollLink seed={seed} resetKey={`${mode}-${seed}`} />
          ) : (
            <p className="py-24 text-center text-ink-faint">В этом режиме кадров нет.</p>
          )
        ) : (
          <div className="h-[70vh]" aria-hidden />
        )}
      </div>
    </div>
  );
}
