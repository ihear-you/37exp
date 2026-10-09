"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "../login/actions";

export interface MenuUser {
  name: string;
  handle: string;
  avatarUrl: string | null;
}

/** Справа в шапке: аватар с меню (моя страница, выход) или «Войти», если не вошли. */
export default function UserMenu({ user }: { user: MenuUser | null }) {
  const path = usePathname();
  // меню открыто на конкретной странице: при переходе на другую оно само считается закрытым
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const box = useRef<HTMLDivElement>(null);

  // закрываем по Esc и по клику снаружи
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpenAt(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!user) {
    if (path === "/login") return null;
    return (
      <Link
        href="/login"
        className="rounded-control bg-paper-deep px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-soft transition-colors hover:text-ink"
      >
        Войти
      </Link>
    );
  }

  const initial = (user.name.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Меню профиля"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenAt(open ? null : path)}
        className="grid size-9 place-items-center overflow-hidden rounded-full bg-paper-deep text-sm text-ink-soft ring-1 ring-line transition-shadow hover:ring-2 hover:ring-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/60"
      >
        {user.avatarUrl ? (
          // аватар лежит у Яндекса; оптимизатор не нужен, referrer не отправляем
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-[16px] bg-paper-light py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line"
        >
          <p className="truncate px-4 pb-2 pt-3 text-sm text-ink">{user.name}</p>
          <Link
            href={`/u/${user.handle}`}
            role="menuitem"
            className="block px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
          >
            Моя страница
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
            >
              Выйти
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
