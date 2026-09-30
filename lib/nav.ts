"use client";

import { usePathname } from "next/navigation";

/** Показывать общую навигацию (Лента/Папки/Загрузить) — и капсулу в шапке на десктопе, и
 * вкладки в нижнем баре на мобильном/планшете (см. SiteHeader.tsx и BottomBarNav.tsx) — только
 * когда в архиве уже есть кадры и мы не на самой странице загрузки (там сверху своя кнопка
 * «Назад», см. BackButton.tsx). Одна функция для обоих мест, чтобы условие не разъехалось.
 * /preview-welcome — служебная страница для просмотра пустого состояния ленты (см. её файл):
 * hasFrames там всегда true (берётся из настоящего каталога в layout.tsx, а не подменяется),
 * поэтому её приходится исключать явно, иначе шапка на ней всегда с навигацией.
 */
export function useShowNav(hasFrames: boolean) {
  const path = usePathname();
  return hasFrames && !path.startsWith("/upload") && path !== "/preview-welcome";
}

/** Именно тогда, когда за хедером — не обычная страница, а сам WelcomeReel во весь экран
 * (в реальном пустом архиве на «/», или на служебной /preview-welcome, см. её файл): тогда
 * хедер становится прозрачным, чтобы сквозь него было видно, как летят фотографии
 * (см. SiteHeader.tsx). На /upload и /rolls hasFrames тоже может быть false, но WelcomeReel
 * там не показывается — их отдельно исключаем через проверку "/".
 */
export function useIsWelcomeScreen(hasFrames: boolean) {
  const path = usePathname();
  return (path === "/" && !hasFrames) || path === "/preview-welcome";
}
