"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UploadIcon } from "./icons";

const NAV = [
  { href: "/", label: "Лента" },
  { href: "/rolls", label: "Папки" },
];

export default function SiteHeader() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const uploading = path.startsWith("/upload");

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-paper/90 backdrop-blur-md">
      <nav className="mx-auto flex h-full max-w-[1600px] items-center gap-2 px-3 md:gap-8 md:px-5" aria-label="Основное">
        <Link
          href="/"
          className="font-logo shrink-0 whitespace-nowrap text-[20px] leading-none tracking-tight md:text-[24px]"
        >
          [37exp]
        </Link>
        <div className="flex items-center">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`rounded-full px-2.5 py-1.5 text-sm transition-colors md:px-3 ${
                active(n.href) ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </div>
        <Link
          href="/upload"
          aria-current={uploading ? "page" : undefined}
          className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ring-1 transition-colors ${
            uploading ? "bg-ink text-paper ring-ink" : "text-ink ring-ink/40 hover:bg-ink hover:text-paper"
          }`}
        >
          <UploadIcon width={15} height={15} />
          Загрузить
        </Link>
      </nav>
    </header>
  );
}
