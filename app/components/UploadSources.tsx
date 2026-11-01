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
  "relative flex flex-col items-center justify-center rounded-[20px] bg-paper-card p-5 text-center md:min-h-72 md:p-8";
const action = "mt-5 flex min-h-10 items-center";
const badge = "grid size-10 place-items-center";
const primary = "h-11 rounded-control bg-ink px-5 text-sm md:h-9 text-paper transition-opacity hover:opacity-85 disabled:bg-paper-edge disabled:text-ink-faint disabled:opacity-100";
const secondary = "h-11 rounded-control bg-paper-deep px-5 text-sm md:h-9 text-ink ring-1 ring-line transition-colors hover:bg-paper-edge";

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
  const [fileError, setFileError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

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
        {/* на плитку можно бросить файлы или папку; или выбрать их кнопками */}
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
          <span className="mt-1 max-w-xs text-sm text-ink-soft">Сканы плёнки с компьютера или телефона</span>
          <div className={`${action} gap-2`}>
            <button type="button" onClick={() => filesInput.current?.click()} className={`${primary} shrink-0`}>
              Выбрать фото
            </button>
            {/* папку целиком умеют отдавать только браузеры на компьютере: на телефоне второй кнопки нет */}
            <button type="button" onClick={() => folderInput.current?.click()} className={`${secondary} hidden shrink-0 md:block`}>
              Выбрать папку
            </button>
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
          className={tile}
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
              className={`${control} min-w-0 flex-1`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="disk.yandex.ru/d/…"
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
