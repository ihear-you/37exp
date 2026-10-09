import type { Metadata } from "next";
import Link from "next/link";
import { configuredProviders } from "@/lib/auth/providers";
import { getViewer } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/config";
import { signOutAction } from "./actions";

export const metadata: Metadata = { title: "Вход · [37exp]" };

const ERRORS: Record<string, string> = {
  config: "Вход ещё не настроен: в .env.local нет ключей Google или Яндекса (см. README).",
  denied: "Вход отменён.",
  state: "Не удалось завершить вход, попробуйте ещё раз.",
  provider: "Не удалось получить данные от сервиса входа, попробуйте ещё раз.",
  email: "Сервис входа не передал почту. Для Яндекса проверьте, что у приложения включён доступ к адресу электронной почты.",
};

const button = "inline-flex items-center rounded-control px-3.5 py-3 text-[11px] uppercase tracking-wider transition-colors";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, next } = await searchParams;
  const viewer = await getViewer();
  const providers = configuredProviders();
  const back = safeNext(typeof next === "string" ? next : null);
  const message = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-20 pt-6 md:px-5 md:pt-8">
      <Link href="/" className="text-sm text-ink-faint transition-colors hover:text-ink">
        ← На главную
      </Link>
      <h1 className="mt-4 text-[26px] leading-tight md:text-[36px]">Вход</h1>

      {message && <p className="mt-4 max-w-2xl text-accent-vivid">{message}</p>}

      {viewer ? (
        <>
          <p className="mt-3 max-w-2xl text-ink-soft">
            Вы вошли как {viewer.name}
            {viewer.email ? ` (${viewer.email})` : ""}.
          </p>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Ваша страница для друзей: <Link href={`/u/${viewer.handle}`} className="underline underline-offset-4 hover:text-ink">/u/{viewer.handle}</Link>.
            Показываются плёнки, которые вы сделали открытыми всем. Плёнки «по ссылке» и «только я» там не видны.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/upload" className={`${button} bg-ink text-paper hover:bg-ink/85`}>
              Загрузить
            </Link>
            <Link href="/rolls" className={`${button} bg-paper-deep text-ink-faint hover:text-ink-soft`}>
              Мои папки
            </Link>
            <form action={signOutAction}>
              <button type="submit" className={`${button} bg-paper-deep text-ink-faint hover:text-ink-soft`}>
                Выйти
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 max-w-2xl text-ink-soft">
            Чужие плёнки можно смотреть по ссылке без входа. Войти нужно, чтобы завести свой архив: загружать плёнки,
            править папки и выбирать, кто их видит.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {/* обычные ссылки, не Link: маршрут ставит cookie и ведёт на другой сайт, предзагружать его нельзя */}
            {providers.map((p) => (
              <a
                key={p.id}
                href={`/api/auth/${p.id}?next=${encodeURIComponent(back)}`}
                className={`${button} bg-ink text-paper hover:bg-ink/85`}
              >
                Войти через {p.label}
              </a>
            ))}
            {providers.length === 0 && !message && <p className="text-ink-faint">Вход ещё не настроен (см. README).</p>}
          </div>
        </>
      )}
    </div>
  );
}
