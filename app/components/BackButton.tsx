"use client";

import { useRouter } from "next/navigation";
import { ChevronIcon } from "./icons";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="-ml-2 flex items-center gap-1 rounded-full px-2 py-1 text-[11px] uppercase tracking-wider text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
    >
      <ChevronIcon dir="left" width={13} height={13} />
      Назад
    </button>
  );
}
