"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { collectDropped, handOffUpload, isImageFile, type UploadHandoff } from "@/lib/upload-handoff";
import { previewImportAction } from "../upload/actions";
import { control } from "./fields";
import { UploadIcon } from "./icons";
import PhotoFan, { type FanPic } from "./PhotoFan";

// Плитки устроены одинаково: значок, заголовок, подпись и сразу под ними действие (кнопка или поле ссылки),
// всё по центру плитки. Значок и строка действия в обеих одной высоты, поэтому всё стоит на одном уровне
const tile =
  "relative flex flex-col items-center justify-center rounded-[20px] bg-paper-light p-5 text-center shadow-[var(--card-ring)] transition-shadow md:min-h-72 md:p-8";
const action = "mt-5 flex min-h-10 items-center";
const badge = "grid size-10 place-items-center";
const primary = "rounded-control bg-ink px-5 py-2 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40";

/**
 * Первый шаг загрузки: два способа взять кадры — с устройства (выбрать или перетащить файлы или папку) и по ссылке
 * с Яндекс Диска. Стоит на /upload и на пустой странице папок. Выбранное уходит в onPick; без него (на странице
 * папок) — на /upload через lib/upload-handoff.ts, там загрузка и начнётся.
 * photos: фото Unsplash для веера над заголовком, такого же, как на карточке папки; без них веера нет.
 */
export default function UploadSources({
  photos,
  onPick,
}: {
  photos: FanPic[];
  onPick?: (picked: UploadHandoff) => void;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  /** На компьютере «Загрузить» спрашивает, что выбрать: фото или папку целиком (папку умеют отдавать только они) */
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => !menuBox.current?.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const chooseFiles = () => {
    // на телефоне папку не выбрать: сразу фото
    if (window.matchMedia("(min-width: 768px)").matches) setMenu((v) => !v);
    else filesInput.current?.click();
  };

  const pick = (picked: UploadHandoff) => {
    if (onPick) return onPick(picked);
    handOffUpload(picked);
    router.push("/upload");
  };

  const takeFiles = (files: File[], folder: string | null) => {
    if (!files.length) return;
    if (!files.some(isImageFile)) {
      setFileError(folder ? "В этой папке нет картинок" : "Это не картинки: нужны JPEG, PNG, TIFF или WebP");
      return;
    }
    setFileError(null);
    pick({ kind: "files", files, folder });
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>, isFolder: boolean) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    takeFiles(files, isFolder ? (files[0]?.webkitRelativePath.split("/")[0] ?? null) : null);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const { files, folder } = await collectDropped(e.dataTransfer);
    takeFiles(files, folder);
  };

  const findByLink = async () => {
    const link = url.trim();
    if (!link || busy) return;
    setBusy(true);
    setLinkError(null);
    const res = await previewImportAction(link);
    if (!res.ok) {
      setBusy(false);
      setLinkError(res.error);
      return;
    }
    setBusy(false);
    pick({ kind: "link", url: link, listing: res });
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-4xl flex-col justify-center pb-28 pt-2 md:pb-16 md:pt-6">
      {/* на телефоне веер меньше: обе плитки должны поместиться на экран над нижним баром */}
      {photos.length > 0 && (
        <div className="mx-auto mb-4 w-full max-w-40 md:mb-8 md:max-w-80">
          <PhotoFan pics={photos} />
        </div>
      )}
      <h1 className="font-display text-center text-[26px] leading-tight md:text-[36px]">Загрузите плёнку</h1>

      <div className="mt-5 grid gap-3 md:mt-8 md:grid-cols-2 md:gap-4">
        {/* на плитку можно бросить файлы или папку; «Загрузить» — выбрать фото или папку */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`${tile} ${drag ? "shadow-[var(--card-ring-hover)] ring-2 ring-accent" : ""}`}
        >
          <span className={badge}>
            <UploadIcon width={30} height={30} className="text-ink-soft" />
          </span>
          <span className="mt-4 text-lg">С устройства</span>
          <span className="mt-1 max-w-xs text-sm text-ink-soft">Отдельные фото или папку целиком</span>
          <div ref={menuBox} className={`${action} relative`}>
            <button type="button" aria-expanded={menu} onClick={chooseFiles} className={`${primary} shrink-0`}>
              Загрузить
            </button>
            {menu && (
              <div className="absolute left-1/2 top-full z-20 mt-2 w-44 -translate-x-1/2 overflow-hidden rounded-control bg-paper-light py-1 text-left text-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line">
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    filesInput.current?.click();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-ink-soft hover:bg-paper-deep hover:text-ink"
                >
                  Фото
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    folderInput.current?.click();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-ink-soft hover:bg-paper-deep hover:text-ink"
                >
                  Папку целиком
                </button>
              </div>
            )}
          </div>
          <input ref={filesInput} type="file" multiple accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => onFiles(e, false)} />
          <input ref={folderInput} type="file" multiple className="sr-only" tabIndex={-1} onChange={(e) => onFiles(e, true)} />
          {fileError && (
            <p className="mt-3 text-sm text-accent-vivid" role="alert">
              {fileError}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void findByLink();
          }}
          className={`${tile} focus-within:shadow-[var(--card-ring-hover)]`}
        >
          {/* сервисы, откуда можно взять ссылку; пока только Яндекс Диск */}
          {/* значок сервиса, откуда берётся ссылка (пока только Яндекс Диск), со скруглёнными углами */}
          <span className={badge}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brands/yandex-disk.png" alt="Яндекс Диск" width={40} height={40} className="size-10 rounded-[10px]" />
          </span>
          <span className="mt-4 text-lg">По ссылке</span>
          <span className="mt-1 max-w-xs text-sm text-ink-soft">Публичная ссылка на папку со сканами</span>
          <div className={`${action} w-full max-w-sm justify-center gap-2`}>
            <input
              className={`${control} min-w-0 flex-1 bg-paper`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://disk.yandex.ru/d/…"
              inputMode="url"
              autoComplete="off"
              aria-label="Публичная ссылка на папку"
            />
            <button type="submit" disabled={busy || !url.trim()} className={`${primary} shrink-0`}>
              {busy ? "Ищем…" : "Загрузить"}
            </button>
          </div>
          {linkError && (
            <p className="mt-3 text-sm text-accent-vivid" role="alert">
              {linkError}
            </p>
          )}
        </form>
      </div>

      {photos.length > 0 && (
        <a
          href="https://unsplash.com/?utm_source=photo-lab&utm_medium=referral"
          target="_blank"
          rel="noreferrer"
          className="mx-auto mt-6 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          Фото сообщества Unsplash
        </a>
      )}
    </div>
  );
}
