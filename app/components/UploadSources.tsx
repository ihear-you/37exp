"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { collectDropped, handOffUpload, isImageFile, type UploadHandoff } from "@/lib/upload-handoff";
import { previewImportAction } from "../upload/actions";
import { control } from "./fields";
import { LinkIcon, UploadIcon } from "./icons";
import PhotoFan, { type FanPic } from "./PhotoFan";

const tile =
  "flex min-h-48 flex-col items-center justify-center rounded-[20px] bg-paper-light p-6 text-center shadow-[var(--card-ring)] transition-shadow md:min-h-72 md:p-8";

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
    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-4xl flex-col justify-center pb-28 pt-6 md:pb-16">
      {photos.length > 0 && (
        <div className="mx-auto mb-6 w-full max-w-60 md:mb-8 md:max-w-80">
          <PhotoFan pics={photos} />
        </div>
      )}
      <h1 className="text-center text-[26px] leading-tight md:text-[36px]">Загрузите плёнку</h1>

      <div className="mt-8 grid gap-3 md:grid-cols-2 md:gap-4">
        {/* плитка целиком открывает выбор файлов, на неё же можно бросить файлы или папку; «выбрать папку» — кнопка под ней */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`${tile} relative hover:shadow-[var(--card-ring-hover)] ${drag ? "shadow-[var(--card-ring-hover)] ring-2 ring-accent" : ""}`}
        >
          <label className="flex cursor-pointer flex-col items-center after:absolute after:inset-0 after:rounded-[20px]">
            <UploadIcon width={32} height={32} className="text-ink-soft" />
            <span className="mt-4 text-lg">С устройства</span>
            <span className="mt-1 max-w-xs text-sm text-ink-soft">Сканы плёнки с компьютера или телефона</span>
            <input type="file" multiple accept="image/*" className="sr-only" onChange={(e) => onFiles(e, false)} />
          </label>
          {/* папку целиком умеют отдавать только браузеры на компьютере */}
          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            className="relative z-10 mt-4 hidden text-sm text-ink-faint underline decoration-ink-faint/40 underline-offset-4 transition-colors hover:text-ink md:block"
          >
            или выбрать папку целиком
          </button>
          <input ref={folderInput} type="file" multiple className="sr-only" tabIndex={-1} onChange={(e) => onFiles(e, true)} />
          {fileError && (
            <p className="relative z-10 mt-3 text-sm text-accent-vivid" role="alert">
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
          <LinkIcon width={32} height={32} className="text-ink-soft" />
          <span className="mt-4 text-lg">По ссылке с Яндекс Диска</span>
          <span className="mt-1 max-w-xs text-sm text-ink-soft">Публичная ссылка на папку со сканами</span>
          <div className="mt-5 flex w-full max-w-sm flex-wrap justify-center gap-2">
            <input
              className={`${control} min-w-0 flex-1 basis-48 bg-paper`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://disk.yandex.ru/d/…"
              inputMode="url"
              autoComplete="off"
              aria-label="Публичная ссылка на Яндекс Диск"
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="rounded-control bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
            >
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
