"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsWelcomeScreen, useShowNav } from "@/lib/nav";
import { UploadIcon } from "./icons";
import UserMenu, { type MenuUser } from "./UserMenu";

const NAV = [
  { href: "/", label: "Лента" },
  { href: "/rolls", label: "Папки" },
];

/** hasArchive: есть хоть одна плёнка. Пока плёнок нет, вместо ленты и папок экран с плитками загрузки
 * (или заставка гостя) — правые кнопки шапки тогда только дублируют его, поэтому скрыты (см. useShowNav в lib/nav.ts).
 * Ниже md эти же кнопки живут в нижнем баре (BottomBarNav.tsx), поэтому здесь на мобильном
 * и планшете они тоже скрыты — остаётся только логотип. */
export default function SiteHeader({
  hasArchive,
  rollCount,
  user,
  signIn,
}: {
  hasArchive: boolean;
  rollCount: number;
  user: MenuUser | null;
  /** Сервис входа для кнопки гостя; null — ключей нет */
  signIn: { id: string; label: string } | null;
}) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const showNav = useShowNav(hasArchive);
  // На пустой ленте под хедером летают фотографии (WelcomeReel, во весь экран, включая
  // область под хедером) — хедер тогда прозрачный, чтобы это было видно, а не закрыто фоном.
  const welcome = useIsWelcomeScreen(hasArchive);

  return (
    <header className={`sticky top-0 z-30 h-20 ${welcome ? "" : "bg-paper/90 backdrop-blur-md"}`}>
      <nav className="mx-auto flex h-full max-w-[1600px] items-center px-3 md:px-5" aria-label="Основное">
        <Link
          href="/"
          className="font-logo shrink-0 whitespace-nowrap text-[22px] leading-none tracking-tight md:text-[30px]"
        >
          [37exp]
        </Link>

        {showNav && (
          <div className="ml-auto hidden items-center gap-4 md:flex">
            <div className="flex items-center gap-0.5 rounded-control bg-paper-deep p-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active(n.href) ? "page" : undefined}
                  className={`rounded-control px-3.5 py-2 text-[11px] uppercase tracking-wider transition-colors ${
                    active(n.href) ? "bg-paper-edge text-ink" : "text-ink-faint hover:text-ink-soft"
                  }`}
                >
                  {n.label}
                  {n.href === "/rolls" && rollCount > 0 && <span className="ml-1.5 tabular-nums opacity-60">{rollCount}</span>}
                </Link>
              ))}
            </div>
            <Link
              href="/upload"
              aria-label="Загрузить"
              className="flex items-center gap-1.5 rounded-control bg-ink px-3.5 py-3 text-[11px] uppercase tracking-wider text-paper transition-colors hover:bg-ink/85"
            >
              <UploadIcon width={14} height={14} />
              <span className="hidden sm:inline">Загрузить</span>
            </Link>
          </div>
        )}

        {/* аватар с выходом (или «Войти») виден всегда, в том числе на телефоне и на пустой ленте.
            Кроме заставки для гостя: там «Войти» — главная кнопка по центру, вторая в углу её дублирует */}
        {!(welcome && !user) && (
          <div className={showNav ? "ml-auto md:ml-4" : "ml-auto"}>
            <UserMenu user={user} signIn={signIn} />
          </div>
        )}
      </nav>
    </header>
  );
}
