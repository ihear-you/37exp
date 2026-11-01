"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "./icons";

const look = "grid place-items-center rounded-control bg-paper-deep text-ink-faint transition-colors hover:text-ink-soft";

/**
 * «Назад»: квадратная кнопка со стрелкой в стиле фильтров «Папок» (тёмная заливка, приглушённая стрелка).
 * С href — ссылка на заданную страницу, 32 px вровень с кнопками страницы плёнки; без него — шаг назад по истории, 40 px
 */
export default function BackButton({ href, label }: { href?: string; label?: string }) {
  const router = useRouter();

  if (href)
    return (
      <Link href={href} aria-label={label} title={label} className={`${look} size-8`}>
        <ArrowLeftIcon width={20} height={20} />
      </Link>
    );

  return (
    <button type="button" onClick={() => router.back()} aria-label="Назад" title="Назад" className={`${look} size-10`}>
      <ArrowLeftIcon width={24} height={24} />
    </button>
  );
}
