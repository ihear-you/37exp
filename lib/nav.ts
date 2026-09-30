"use client";

import { usePathname } from "next/navigation";

/** Показывать общую навигацию (Лента/Папки/Загрузить) — и капсулу в шапке на десктопе, и
 * вкладки в нижнем баре на мобильном/планшете (см. SiteHeader.tsx и BottomBarNav.tsx) — только
 * когда в архиве уже есть кадры и мы не на самой странице загрузки (там сверху своя кнопка
 * «Назад», см. BackButton.tsx). Одна функция для обоих мест, чтобы условие не разъехалось.
 */
export function useShowNav(hasFrames: boolean) {
  const path = usePathname();
  return hasFrames && !path.startsWith("/upload");
}
