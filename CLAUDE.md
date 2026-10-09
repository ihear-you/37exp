# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Проект

«[37exp]» — архив плёночных кадров (лента + папки), на русском. Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, TypeScript. Бриф — `brief-mvp.md`, обзор экранов и настроек ленты — `README.md`.

Next здесь не тот, что в обучающих данных: перед правкой роутинга/кэша/`next/image` сверяйся с `node_modules/next/dist/docs/`.

## Команды

```bash
npm run dev      # http://localhost:3000 (конфиг превью: .claude/launch.json, имя "photo-lab")
npm run build
npm run lint     # eslint с react-hooks: запрещает setState/мутации в эффектах и во время рендера
npx tsc --noEmit # отдельной команды typecheck нет
npm run import   # scripts/import-photos.mjs: из папок в SOURCES делает public/photos/{f,l} и lib/photos/frames.json
```

Тестов нет.

## Архитектура

- **Данные — не база, а модуль.** В `main` справочники, плёнки (`ROLLS`) и кадры (`FRAMES` из `lib/photos/frames.json`) живут в `lib/catalog.ts`; всё читается синхронно на сервере и клиенте. Загрузка (`UploadPrototype.tsx`) ничего не сохраняет. `id` плёнки в `ROLLS` и номер в `SOURCES` скрипта импорта должны совпадать. Файлы кадров: `public/photos/f/<id>.jpg` (лента) и `l/` (просмотр), они лежат в git.
- **Работа с БД/входом ведётся отдельно** (`better-sqlite3` в зависимостях, `photolab.db` в корне, OAuth Google/Яндекс через `arctic`, `lib/db`, `lib/auth`) — на момент написания это незакоммиченные правки в worktree `claude/upbeat-hugle-740cd1`, в `main` кода входа нет. Не предполагай, что `/login`, `requireUser` и т.п. существуют в `main`, проверь.
- **Лента** — `lib/feed.ts` (`planFeed`: ритм крупных/широких кадров и подписей, тёплый/холодный уклон) + `lib/masonry.ts` (раскладка без обрезки) + `Masonry.tsx`/`Feed.tsx`. Порядок хранится только в памяти вкладки (`lib/persist.ts`, kind `"memory"`) и меняется на каждую загрузку.
- **`lib/persist.ts`** — мини-хранилище на `useSyncExternalStore`: на сервере и при первой отрисовке отдаёт запасное значение, чтобы гидрация не расходилась. Тот же приём (детерминированный `SEED`, `lib/rand.ts: mulberry32`) нужен везде, где SSR и клиент должны нарисовать одно и то же.
- **Шапка и навигация** считаются в одном месте, `lib/nav.ts` (`useShowNav`, `useIsWelcomeScreen`), и используются и в `SiteHeader` (десктоп), и в `BottomBarNav` (ниже `md`) — условия нельзя дублировать. Пустое состояние (`hasFrames === false` на `/`, а также служебная `/preview-welcome`): без кнопок Лента/Папки/Загрузить, хедер прозрачный.
- **Пустая лента — `WelcomeReel.tsx`**: полноэкранный (`fixed inset-0`) коллаж на CSS-keyframes (`tile-burst` в `globals.css`), плитки по зонам 4×4, рост от центра экрана через `transform-origin` в процентах, перезапуск по `onAnimationEnd` + `key`. Фото берёт из `lib/unsplash.ts`, при отсутствии ключа/ответа — из локальных кадров. `/preview-welcome` — dev-страница, рисует его независимо от наличия кадров.
- **Unsplash** (`lib/unsplash.ts`): только серверный вызов, ключ `UNSPLASH_ACCESS_KEY` в `.env.local` (в git не попадает). Демо-лимит 50 запросов/ч, поэтому один запрос «motion blur» и `revalidate` сутки. Кредит «Фото сообщества Unsplash» в углу обязателен.
- **Стили**: цвета и радиусы — токены в `:root` в `app/globals.css` (`--round-control`, `--round-frame`, проброшены в Tailwind как `rounded-control`/`rounded-frame` через `@theme inline`). Курсива нет; Anton — только логотип (`font-logo`), весь текст — IBM Plex Sans.

## Подводные камни

- **Worktrees:** у каждого worktree свой `.env.local` (gitignored) — в новом нет `UNSPLASH_ACCESS_KEY`, и пустое состояние тихо переключается на локальные кадры. Stash общий для всех worktree: не используй голый `git stash`/`pop`.
- **Прод `https://37exp.ru`** (nginx перед Next): при переносе нужны `public/photos/**` и переменная `UNSPLASH_ACCESS_KEY` в окружении сервера, иначе `/photos/f/*.jpg` отдаёт 404, а пустая лента остаётся без кадров.
- **Проверка анимации в превью:** в скрытой панели браузера `document.hidden === true`, и скриншоты выходят чёрными — это не пустота, сначала выведи вкладку на передний план.
