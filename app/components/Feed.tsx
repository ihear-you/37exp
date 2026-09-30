"use client";

import { useMemo } from "react";
import type { Frame, RollView } from "@/lib/catalog";
import { orderFrames, pickTint } from "@/lib/feed";
import { newSeed } from "@/lib/rand";
import { createStore, useStore } from "@/lib/persist";
import type { EditorialPhoto } from "@/lib/unsplash";
import Masonry from "./Masonry";
import WelcomeReel from "./WelcomeReel";

interface Visit {
  seed: number;
}

// Новый порядок на каждую полную загрузку страницы: seed живёт только в памяти вкладки
// (kind "memory" — см. lib/persist.ts), а не в sessionStorage, поэтому обновление страницы
// не сохраняет прежний порядок. Пока открыта вкладка (переходы между страницами сайта без
// перезагрузки), порядок остаётся тем же.
const visitStore = createStore<Visit>("plenka:visit", "memory", () => ({ seed: newSeed() }));

export default function Feed({
  frames,
  rolls,
  photos,
}: {
  frames: Frame[];
  rolls: Record<number, RollView>;
  photos: EditorialPhoto[];
}) {
  const visit = useStore(visitStore);
  const seed = visit?.seed ?? 1;

  const ordered = useMemo(() => orderFrames(frames, seed, pickTint(seed)), [frames, seed]);

  // Пустая лента — коллаж во весь экран, без отступов и общей ширины остальной ленты
  if (visit && ordered.length === 0) return <WelcomeReel photos={photos} />;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-16 md:px-5">
      <div className="pt-4 md:pt-5">
        {visit ? (
          <Masonry frames={ordered} rolls={rolls} rhythm rollLink seed={seed} resetKey={`${seed}`} />
        ) : (
          <div className="h-[70vh]" aria-hidden />
        )}
      </div>
    </div>
  );
}
