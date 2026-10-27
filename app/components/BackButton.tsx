"use client";

import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "./icons";

/** «Назад»: квадратная кнопка со стрелкой 24 px в стиле фильтров «Папок» (тёмная заливка, приглушённая стрелка) */
export default function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Назад"
      title="Назад"
      className="grid size-10 place-items-center rounded-control bg-paper-deep text-ink-faint transition-colors hover:text-ink-soft"
    >
      <ArrowLeftIcon width={24} height={24} />
    </button>
  );
}
