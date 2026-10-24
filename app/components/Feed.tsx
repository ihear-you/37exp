"use client";

import { startTransition, useEffect, useMemo, useOptimistic } from "react";
import type { Frame, RollView } from "@/lib/catalog";
import { orderFrames, pickTint } from "@/lib/feed";
import { newSeed } from "@/lib/rand";
import { createStore, useStore } from "@/lib/persist";
import { useRouter } from "next/navigation";
import { noteDeleted } from "@/lib/undo";
import { deleteFrameAction, rotateFrameAction } from "../rolls/[id]/actions";
import Masonry from "./Masonry";

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
}: {
  frames: Frame[];
  rolls: Record<number, RollView>;
}) {
  const visit = useStore(visitStore);
  const router = useRouter();
  // в ленте только свои кадры: повернуть можно любой; после поворота страница берёт новые копии
  const rotate = async (id: string) => {
    const result = await rotateFrameAction(id);
    if (result.ok) router.refresh();
    return result;
  };
  // удалить тоже можно прямо из ленты: кадр исчезает сразу (если сервер не смог — возвращается),
  // а в углу несколько секунд висит «Кадр удалён · Отменить» (lib/undo.ts)
  const [visible, removeFrame] = useOptimistic(frames, (cur, id: string) => cur.filter((f) => f.id !== id));
  const remove = (id: string) => {
    startTransition(async () => {
      removeFrame(id);
      if (await deleteFrameAction(id)) noteDeleted(id);
      else alert("Не удалось удалить кадр");
    });
  };
  const seed = visit?.seed ?? 1;

  // порядок устойчив к удалению (lib/feed.ts): остальные кадры остаются на своих местах
  const ordered = useMemo(() => orderFrames(visible, seed, pickTint(seed)), [visible, seed]);

  // Кадров нет, а папки есть (все кадры удалили): тихая заглушка без своей кнопки — «Загрузить» есть в навигации.
  // Папок тоже нет — на «Папки» с плитками загрузки (так же ведёт и сервер, app/(feed)/page.tsx)
  const noRolls = Object.keys(rolls).length === 0;
  useEffect(() => {
    if (noRolls) router.replace("/rolls");
  }, [noRolls, router]);
  if (noRolls) return null;
  if (visit && ordered.length === 0) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-3 text-center">
        <p className="text-lg text-ink">Пока нет загруженных фотографий</p>
        <p className="mt-2 text-sm text-ink-soft">Загрузите плёнку, и кадры появятся здесь</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-16 md:px-5">
      <div className="pt-4 md:pt-5">
        {visit ? (
          <Masonry frames={ordered} rolls={rolls} rhythm rollLink seed={seed} resetKey={`${seed}`} onRotateFrame={rotate} onDeleteFrame={remove} />
        ) : (
          <div className="h-[70vh]" aria-hidden />
        )}
      </div>
    </div>
  );
}
