"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShowNav } from "@/lib/nav";
import { GridIcon, FolderIcon, UploadIcon } from "./icons";

const ITEMS = [
  { href: "/", label: "Лента", icon: GridIcon },
  { href: "/rolls", label: "Папки", icon: FolderIcon },
  { href: "/upload", label: "Загрузить", icon: UploadIcon },
];

/** Ниже md (планшет и телефон) те же кнопки, что в шапке на десктопе, — вкладками внизу
 * экрана; та же логика показа, что и в шапке (см. useShowNav в lib/nav.ts), поэтому пока
 * плёнок нет, бар не показывается вовсе. На странице загрузки, в отличие от шапки, он остаётся. */
export default function BottomBarNav({ hasArchive, rollCount }: { hasArchive: boolean; rollCount: number }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const showNav = useShowNav(hasArchive, { onUpload: true });

  if (!showNav) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Основное"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors ${
              isActive ? "text-ink" : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            <Icon width={20} height={20} />
            <span>
              {item.label}
              {item.href === "/rolls" && rollCount > 0 && <span className="ml-1 tabular-nums opacity-60">{rollCount}</span>}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
