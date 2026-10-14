"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ISO_VALUES,
  MONTHS,
  filmLabel,
  makeTitle,
  type Camera,
  type Film,
  type Format,
} from "@/lib/catalog";
import { parseFolderName } from "@/lib/folder-name";
import { createStore, useStore } from "@/lib/persist";
import { isImageFile, takeUploadHandoff, type LinkListing } from "@/lib/upload-handoff";
import {
  createCameraAction,
  createFilmAction,
  previewImportAction,
  retryImportAction,
  startImportAction,
  startUploadAction,
} from "../upload/actions";
import { control, Select } from "./fields";
import { CheckIcon, RetryIcon, UploadIcon } from "./icons";

// Последняя выбранная камера запоминается в браузере (сами камеры лежат в базе)
interface CameraMemory {
  last: string;
}
const cameraStore = createStore<CameraMemory>("plenka:cameras", "local", () => ({
  last: "",
}));
const CAMERA_FALLBACK: CameraMemory = { last: "" };

/** Плёнка, в которую можно добавить кадры */
interface UploadRoll {
  id: number;
  title: string;
  year: number;
  month: number;
}

/** Что написать, если сервер отказал (коды из app/api/rolls/[id]/frames) */
const ERRORS: Record<string, string> = {
  auth: "Войдите заново и повторите",
  size: "Файл слишком большой",
  quota: "Не хватает места в вашем архиве",
  format: "Не удалось прочитать картинку: формат не поддерживается",
  roll: "Плёнка не найдена",
  storage: "Сервер не смог сохранить файл",
  form: "Сервер не принял файл",
  download: "Не удалось скачать файл с Яндекс Диска",
};

type Status = "queued" | "uploading" | "done" | "error";
interface Item {
  id: number;
  name: string;
  size: number;
  /** Превью: у кадров с компьютера сам файл, у кадров по ссылке миниатюра с Диска (её может не быть).
   *  Файл есть только у кадров с компьютера: по ссылке их скачивает сервер */
  url?: string;
  file?: File;
  /** Номер кадра в плёнке, резервируется при старте загрузки */
  idx: number;
  status: Status;
  progress: number;
  error?: string;
  /** Импорт по ссылке: кадр уже виден в плёнке (по уменьшенной копии), оригинал ещё докачивается */
  shown?: boolean;
}

const NEW = "__new__";
const PARALLEL = 3;
const now = new Date();

// Журнал загрузки в консоли браузера (DevTools → Console, строки «[загрузка]»): когда что отправлено,
// сколько шло по сети, сколько ждали ответа сервера. Серверная половина — в журнале службы (lib/log.ts)
const log = (...args: unknown[]) => console.info("%c[загрузка]", "color:#c2572e;font-weight:bold", ...args);
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`;
const rate = (bytes: number, ms: number) => `${((bytes / 1048576) * (1000 / Math.max(ms, 1))).toFixed(2)} МБ/с`;

export default function UploadPrototype({
  rolls,
  cameras: savedCameras,
  films,
}: {
  rolls: UploadRoll[];
  cameras: Camera[];
  films: Film[];
}) {
  const memory = useStore(cameraStore, CAMERA_FALLBACK);
  const router = useRouter();

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [rollId, setRollId] = useState("");
  const [filmId, setFilmId] = useState("");
  const [format, setFormat] = useState<Format>("35");
  const [iso, setIso] = useState("");
  const [cameraPick, setCameraPick] = useState<string | null>(null);
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [description, setDescription] = useState("");

  const [extraFilms, setExtraFilms] = useState<Film[]>([]);
  const [extraCameras, setExtraCameras] = useState<Camera[]>([]);
  const [addingFilm, setAddingFilm] = useState(false);
  const [newFilm, setNewFilm] = useState("");
  const [addingCamera, setAddingCamera] = useState(false);
  const [newCamera, setNewCamera] = useState("");

  const [items, setItems] = useState<Item[]>([]);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** Куда загрузили: номер плёнки и была ли она создана сейчас (новая плёнка видна только автору) */
  const [uploaded, setUploaded] = useState<{
    rollId: number;
    created: boolean;
  } | null>(null);
  const [tried, setTried] = useState(false);
  const [hint, setHint] = useState<{ folder: string; found: string[] } | null>(
    null,
  );
  const [drag, setDrag] = useState(false);

  // ── источник «по ссылке с Яндекс Диска» ──
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  /** Кадры взяты по ссылке: сервер сам скачает их с Диска (items тогда без файлов) */
  const [link, setLink] = useState<{
    url: string;
    name: string;
    skipped: number;
    tooBig: number;
  } | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [pollKick, setPollKick] = useState(0);

  const folderInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const urls = useRef<string[]>([]);
  const session = useRef<number | null>(null);
  const inflight = useRef(new Set<number>());
  /** для журнала: когда нажали «Загрузить» и что было у файлов импорта при прошлом опросе */
  const startedAt = useRef(0);
  const seen = useRef(new Map<string, string>());

  // добавленное только что и пришедшее с сервера после обновления страницы не должно двоиться
  const allFilms = useMemo(
    () => [
      ...films,
      ...extraFilms.filter((f) => !films.some((x) => x.id === f.id)),
    ],
    [films, extraFilms],
  );
  const cameras = useMemo(
    () => [
      ...savedCameras,
      ...extraCameras.filter((c) => !savedCameras.some((x) => x.id === c.id)),
    ],
    [savedCameras, extraCameras],
  );
  const cameraId =
    cameraPick ??
    (cameras.some((c) => c.id === memory.last)
      ? memory.last
      : (cameras[0]?.id ?? ""));
  const film = allFilms.find((f) => f.id === filmId);
  const existing = rolls.find((r) => String(r.id) === rollId);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // ── загрузка: параллельно по три кадра, каждый отдельным запросом с прогрессом ──
  const send = useCallback((item: Item) => {
    const rollNo = session.current;
    if (rollNo === null) return;
    inflight.current.add(item.id);
    const patch = (p: Partial<Item>) =>
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...p } : i)));
    const finish = (p: Partial<Item>) => {
      inflight.current.delete(item.id);
      patch(p);
    };
    patch({ status: "uploading", progress: 0, error: undefined });
    const t0 = performance.now();
    let sentAt = 0;
    log(`→ №${item.idx} «${item.name}» ${mb(item.size)}: отправка`);

    const body = new FormData();
    body.append("file", item.file!);
    body.append("idx", String(item.idx));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/rolls/${rollNo}/frames`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        patch({ progress: Math.min(99, (e.loaded / e.total) * 100) });
    };
    // файл ушёл целиком: дальше ждём, пока сервер его обработает
    xhr.upload.onload = () => {
      sentAt = performance.now();
      const ms = Math.round(sentAt - t0);
      log(`  №${item.idx}: передан за ${ms} мс (${rate(item.size, ms)}), ждём сервер`);
    };
    xhr.onload = () => {
      const total = Math.round(performance.now() - t0);
      const server = sentAt ? Math.round(performance.now() - sentAt) : null;
      log(
        `← №${item.idx}: ответ ${xhr.status} за ${total} мс${server !== null ? ` (из них ждали сервер ${server} мс)` : ""}`,
        xhr.status === 200 ? "" : xhr.responseText,
      );
      if (xhr.status === 200) return finish({ status: "done", progress: 100 });
      let code = "";
      try {
        code = JSON.parse(xhr.responseText).error;
      } catch {
        // ответ не JSON
      }
      finish({
        status: "error",
        progress: 0,
        error: ERRORS[code] ?? `Ошибка сервера (${xhr.status})`,
      });
    };
    xhr.onerror = () => {
      log(`✕ №${item.idx}: обрыв связи через ${Math.round(performance.now() - t0)} мс${sentAt ? " (файл уже был передан)" : ""}`);
      finish({ status: "error", progress: 0, error: "Нет связи с сервером" });
    };
    xhr.send(body);
  }, []);

  useEffect(() => {
    if (!started || link) return;
    let free = PARALLEL - inflight.current.size;
    for (const i of items) {
      if (free <= 0) break;
      if (i.status === "queued" && !inflight.current.has(i.id)) {
        free--;
        send(i);
      }
    }
  }, [items, started, send, link]);

  // подсказка по названию папки: и для папки с компьютера, и для папки на Диске
  const applyFolderHint = useCallback(
    (folder: string) => {
      const g = parseFolderName(folder, allFilms);
      const found: string[] = [];
      if (g.filmId) {
        setFilmId(g.filmId);
        found.push(allFilms.find((f) => f.id === g.filmId)?.name ?? "");
      }
      if (g.iso) {
        setIso(String(g.iso));
        found.push(`ISO ${g.iso}`);
      }
      if (g.month) {
        setMonth(String(g.month));
        found.push(MONTHS[g.month - 1]);
      }
      if (g.year) {
        setYear(String(g.year));
        found.push(String(g.year));
      }
      setHint({ folder, found });
    },
    [allFilms],
  );

  const addFiles = useCallback(
    (files: File[], folder: string | null) => {
      const images = files
        .filter(isImageFile)
        .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
      if (!images.length) return;
      // источники не смешиваются: кадры с компьютера заменяют найденные по ссылке
      setLink(null);
      setItems((prev) => [
        ...prev.filter((i) => i.file),
        ...images.map((f) => {
          const url = URL.createObjectURL(f);
          urls.current.push(url);
          const id = nextId.current++;
          return {
            id,
            name: f.name,
            size: f.size,
            url,
            file: f,
            idx: 0,
            status: "queued" as const,
            progress: 0,
          };
        }),
      ]);
      // только папка даёт подсказку: у отдельных файлов названия плёнки нет
      if (folder && mode === "new") applyFolderHint(folder);
      else if (!folder) setHint(null);
    },
    [mode, applyFolderHint],
  );

  // кадры, найденные по ссылке, заменяют выбранные раньше
  const showListing = useCallback(
    (url: string, res: LinkListing) => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
      setItems(
        res.files.map((f, n) => ({
          id: -(n + 1),
          name: f.name,
          size: f.size,
          url: f.preview ?? undefined,
          idx: 0,
          status: "queued" as const,
          progress: 0,
        })),
      );
      setLink({ url, name: res.name, skipped: res.skipped, tooBig: res.tooBig });
      if (mode === "new") applyFolderHint(res.name);
      else setHint(null);
    },
    [mode, applyFolderHint],
  );

  // кадры по ссылке: сервер смотрит, что лежит на Диске; сами файлы скачает он же после «Загрузить»
  const findByLink = async () => {
    const url = linkUrl.trim();
    if (!url || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    const t0 = performance.now();
    const res = await previewImportAction(url);
    setLinkBusy(false);
    log(
      `поиск по ссылке за ${Math.round(performance.now() - t0)} мс:`,
      res.ok ? `${res.files.length} кадров, ${mb(res.files.reduce((s, f) => s + f.size, 0))}` : res.error,
    );
    if (!res.ok) {
      setLinkError(res.error);
      return;
    }
    showListing(url, res);
  };

  // Кадры выбраны ещё до формы, на пустой странице папок (EmptyArchive.tsx): забираем их при открытии.
  // Через таймер, а не сразу в эффекте: в dev React запускает эффекты дважды, и первый запуск отменяется
  useEffect(() => {
    const timer = setTimeout(() => {
      const handoff = takeUploadHandoff();
      if (!handoff) return;
      if (handoff.kind === "files") addFiles(handoff.files, handoff.folder);
      else showListing(handoff.url, handoff.listing);
    }, 0);
    return () => clearTimeout(timer);
  }, [addFiles, showListing]);

  // ход импорта по ссылке: сервер качает сам, форма только спрашивает состояние
  useEffect(() => {
    if (!importId || !started) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/imports/${importId}`, { cache: "no-store" });
        if (!r.ok || stopped) return;
        const data = (await r.json()) as {
          finished: boolean;
          items: {
            name: string;
            size: number;
            status: "queued" | "preview" | "working" | "done" | "error";
            error: string | null;
            shown: boolean;
          }[];
        };
        if (stopped) return;
        const changed = data.items.filter((i) => seen.current.get(i.name) !== i.status);
        if (changed.length) {
          const count = (s: string) => data.items.filter((i) => i.status === s).length;
          log(
            `импорт: в плёнке ${data.items.filter((i) => i.shown).length}, оригиналов ${count("done")}, качается ${count("working")}, ошибок ${count("error")} из ${data.items.length}`,
            changed.map((i) => `${i.name}: ${seen.current.get(i.name) ?? "—"} → ${i.status}${i.error ? ` (${i.error})` : ""}`),
          );
          changed.forEach((i) => seen.current.set(i.name, i.status));
        }
        if (data.finished) log(`импорт закончен за ${Math.round((performance.now() - startedAt.current) / 1000)} с`);
        // миниатюры пришли при поиске по ссылке: сохраняем их за теми же файлами
        setItems((prev) =>
          data.items.map((i, n) => ({
            id: -(n + 1),
            name: i.name,
            size: i.size,
            url: prev[n]?.name === i.name ? prev[n].url : undefined,
            idx: 0,
            // preview: кадр уже в плёнке, ждёт оригинал; working: оригинал качается
            status:
              i.status === "working" || i.status === "preview"
                ? ("uploading" as const)
                : i.status,
            progress:
              i.status === "done"
                ? 100
                : i.status === "working"
                  ? 75
                  : i.status === "preview"
                    ? 50
                    : 0,
            shown: i.shown,
            error: i.error ? (ERRORS[i.error] ?? "Не удалось загрузить") : undefined,
          })),
        );
        if (data.finished) {
          stopped = true;
          clearInterval(timer);
        }
      } catch {
        // нет связи: попробуем на следующем шаге
      }
    };
    const timer = setInterval(tick, 1500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [importId, started, pollKick]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const { files, folder } = await collect(e.dataTransfer);
    addFiles(files, folder);
  };

  const onPick = (
    e: React.ChangeEvent<HTMLInputElement>,
    isFolder: boolean,
  ) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    const folder = isFolder
      ? (files[0]?.webkitRelativePath.split("/")[0] ?? null)
      : null;
    addFiles(files, folder);
  };

  // ── справочники ──
  const pickFilm = (v: string) => {
    if (v === NEW) {
      setAddingFilm(true);
      return;
    }
    setFilmId(v);
    const f = allFilms.find((x) => x.id === v);
    if (f?.iso) setIso(String(f.iso));
  };
  const saveFilm = async () => {
    const name = newFilm.trim();
    if (!name) return;
    const guessIso = Number(name.match(/(\d{2,4})\s*$/)?.[1]);
    const f = await createFilmAction(
      name,
      ISO_VALUES.includes(guessIso) ? guessIso : null,
    );
    if (!f) {
      setStartError("Не удалось добавить плёнку");
      return;
    }
    setExtraFilms((p) => [...p, f]);
    setFilmId(f.id);
    if (f.iso) setIso(String(f.iso));
    setNewFilm("");
    setAddingFilm(false);
  };
  const pickCamera = (v: string) => {
    if (v === NEW) {
      setAddingCamera(true);
      return;
    }
    setCameraPick(v);
    cameraStore.set({ last: v });
  };
  const saveCamera = async () => {
    const name = newCamera.trim();
    if (!name) return;
    const c = await createCameraAction(name);
    if (!c) {
      setStartError("Не удалось добавить камеру");
      return;
    }
    setExtraCameras((p) => [...p, c]);
    cameraStore.set({ last: c.id });
    setCameraPick(c.id);
    setNewCamera("");
    setAddingCamera(false);
  };

  // ── проверка и запуск ──
  const isoNum = iso ? Number(iso) : null;
  const title =
    mode === "existing"
      ? existing
        ? existing.title
        : ""
      : film
        ? makeTitle(film, Number(month), Number(year), isoNum)
        : "";
  const problems: string[] = [];
  if (mode === "existing" ? !existing : !film)
    problems.push(
      mode === "existing"
        ? "Выберите плёнку"
        : "Выберите плёнку из списка (можно «Не знаю»)",
    );
  if (mode === "new" && !cameraId && !newCamera.trim())
    problems.push(cameras.length ? "Выберите камеру" : "Укажите камеру");
  if (!items.length) problems.push("Добавьте кадры");

  const start = async () => {
    setTried(true);
    if (problems.length || starting) return;
    setStarting(true);
    setStartError(null);
    startedAt.current = performance.now();
    seen.current.clear();
    log(
      `старт: ${items.length} кадров, ${mb(items.reduce((s, i) => s + i.size, 0))}, ${link ? "по ссылке с Диска" : "с устройства"}, ${mode === "new" ? "новая плёнка" : `в плёнку ${rollId}`}`,
    );
    // камер ещё нет: создаём ту, название которой ввели в поле
    let useCameraId = cameraId;
    if (mode === "new" && !useCameraId) {
      const c = await createCameraAction(newCamera.trim());
      if (!c) {
        setStarting(false);
        setStartError("Не удалось сохранить камеру");
        return;
      }
      setExtraCameras((p) => [...p, c]);
      cameraStore.set({ last: c.id });
      setCameraPick(c.id);
      setNewCamera("");
      useCameraId = c.id;
    }
    const target = {
      rollId: mode === "existing" ? Number(rollId) : null,
      roll:
        mode === "new"
          ? {
              filmId,
              format,
              iso: isoNum,
              cameraId: useCameraId,
              month: Number(month),
              year: Number(year),
              description,
            }
          : null,
    };
    if (link) {
      const res = await startImportAction({ url: link.url, ...target });
      setStarting(false);
      log(`импорт запущен за ${Math.round(performance.now() - startedAt.current)} мс:`, res.ok ? `задание ${res.importId}, плёнка ${res.rollId}` : res.error);
      if (!res.ok) {
        setStartError(res.error);
        return;
      }
      setUploaded({ rollId: res.rollId, created: mode === "new" });
      setImportId(res.importId);
      setStarted(true);
      return;
    }
    const res = await startUploadAction({
      ...target,
      count: items.length,
      totalBytes: items.reduce((sum, i) => sum + i.size, 0),
    });
    setStarting(false);
    log(
      `плёнка готова к приёму за ${Math.round(performance.now() - startedAt.current)} мс:`,
      res.ok ? `плёнка ${res.rollId}, номера с ${res.firstIdx}, отправляем по ${PARALLEL}` : res.error,
    );
    if (!res.ok) {
      setStartError(res.error);
      return;
    }
    session.current = res.rollId;
    setUploaded({ rollId: res.rollId, created: mode === "new" });
    setItems((p) => p.map((i, n) => ({ ...i, idx: res.firstIdx + n })));
    setStarted(true);
  };
  const requeue = (match: (i: Item) => boolean) =>
    setItems((p) =>
      p.map((i) =>
        match(i)
          ? { ...i, status: "queued", progress: 0, error: undefined }
          : i,
      ),
    );
  // у импорта по ссылке повторяет сервер, и сразу все сбойные файлы
  const retryImport = async () => {
    if (!importId) return;
    log("импорт: повтор сбойных файлов");
    requeue((i) => i.status === "error");
    await retryImportAction(importId);
    setPollKick((k) => k + 1);
  };
  const retry = (id: number) => {
    log(`повтор кадра ${items.find((i) => i.id === id)?.name ?? id}`);
    return importId ? void retryImport() : requeue((i) => i.id === id);
  };
  const retryAll = () => {
    log("повтор всех сбойных кадров");
    return importId ? void retryImport() : requeue((i) => i.status === "error");
  };
  const reset = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    session.current = null;
    setLink(null);
    setImportId(null);
    setLinkError(null);
    setLinkUrl("");
    setItems([]);
    setStarted(false);
    setUploaded(null);
    setStartError(null);
    setTried(false);
    setHint(null);
  };

  const done = items.filter((i) => i.status === "done").length;
  const shown = items.filter((i) => i.shown || i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;
  const total = items.length;
  const overall = total ? items.reduce((s, i) => s + i.progress, 0) / total : 0;
  const finished = started && total > 0 && done === total;
  const locked = started && !finished;
  const errors = [
    ...new Set(
      items.filter((i) => i.status === "error" && i.error).map((i) => i.error!),
    ),
  ];

  // после загрузки обновляем списки (новая плёнка попадёт в «Добавить в существующую», в шапку и ленту)
  useEffect(() => {
    if (!finished) return;
    if (!importId) {
      const seconds = (performance.now() - startedAt.current) / 1000;
      log(`всё загружено: ${total} кадров, ${mb(items.reduce((s, i) => s + i.size, 0))} за ${Math.round(seconds)} с`);
    }
    router.refresh();
    // итог пишем один раз, в момент окончания
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, router]);

  const actions = (
    <div className="mt-6">
      {finished ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-[3px] bg-paper-deep px-4 py-3"
          role="status"
        >
          <CheckIcon className="text-ink" />
          <span className="text-sm">
            Готово: {total} кадров в «{title}».
            {uploaded?.created &&
              " Плёнка видна только вам: доступ меняется в настройках папки."}
          </span>
          {uploaded && (
            <Link
              href={`/rolls/${uploaded.rollId}`}
              className="text-sm text-accent underline underline-offset-4"
            >
              Открыть папку
            </Link>
          )}
          <Link
            href="/"
            className="text-sm text-accent underline underline-offset-4"
          >
            К ленте
          </Link>
          <button
            type="button"
            onClick={reset}
            className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
          >
            Загрузить ещё
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={locked || starting}
            className="rounded-control bg-ink px-6 py-2.5 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {locked || starting
              ? "Загружается…"
              : items.length
                ? `Загрузить ${items.length} ${items.length === 1 ? "кадр" : "кадров"}`
                : "Загрузить"}
          </button>
          {items.length > 0 && !locked && (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
            >
              Очистить
            </button>
          )}
        </div>
      )}
      {startError && (
        <p className="mt-3 text-sm text-accent" role="alert">
          {startError}
        </p>
      )}
      {tried && problems.length > 0 && !started && (
        <ul className="mt-3 space-y-0.5 text-sm text-accent" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      {/* ── заголовок и сценарий ── */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 md:mb-10">
        <h1 className="text-[26px] leading-tight md:text-[36px]">
          Загрузка плёнки
        </h1>
        <div
          className="flex w-full rounded-control p-0.5 ring-1 ring-line sm:w-auto"
          role="group"
          aria-label="Сценарий"
        >
          {(
            [
              ["new", "Новая плёнка"],
              ["existing", "Добавить в существующую"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              disabled={locked}
              onClick={() => {
                setMode(id);
                setHint(null);
              }}
              className={`flex-1 rounded-control px-4 py-2 text-sm transition-colors sm:flex-none ${mode === id ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
        {/* ── форма ── */}
        <div className="min-w-0">
          <section
            aria-label="Данные плёнки"
            className={locked ? "pointer-events-none opacity-60" : ""}
          >
            {mode === "existing" ? (
              <div className="space-y-4">
                <Field label="Плёнка" error={tried && !existing}>
                  <Select
                    value={rollId}
                    onChange={(e) => setRollId(e.target.value)}
                  >
                    <option value="">Выберите плёнку…</option>
                    {[...rolls]
                      .sort(
                        (a, b) =>
                          b.year * 12 + b.month - (a.year * 12 + a.month),
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                  </Select>
                </Field>
                <p className="text-sm text-ink-faint">
                  Поля плёнки не меняются: кадры просто добавятся в её папку.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-ink-faint">
                  Доступ к новой плёнке: только вы. Изменить можно в настройках
                  папки.
                </p>
                <Field label="Плёнка" error={tried && !film}>
                  <Select
                    value={filmId}
                    onChange={(e) => pickFilm(e.target.value)}
                  >
                    <option value="">Выберите…</option>
                    {allFilms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {filmLabel(f)}
                      </option>
                    ))}
                    <option value={NEW}>＋ Добавить свою…</option>
                  </Select>
                  {addingFilm && (
                    <Inline
                      value={newFilm}
                      onChange={setNewFilm}
                      onSave={saveFilm}
                      onCancel={() => setAddingFilm(false)}
                      placeholder="Например, Kodak Vision3 500T"
                    />
                  )}
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Формат">
                    <Select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as Format)}
                    >
                      <option value="35">35 мм</option>
                      <option value="120">120</option>
                    </Select>
                  </Field>
                  <Field
                    label="ISO съёмки"
                    hint={
                      film?.iso && isoNum && film.iso !== isoNum
                        ? `на плёнке ${film.iso}: допишется в название`
                        : undefined
                    }
                  >
                    <Select
                      value={iso}
                      onChange={(e) => setIso(e.target.value)}
                    >
                      <option value="">не указано</option>
                      {ISO_VALUES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field
                  label="Камера"
                  error={tried && !cameraId && !newCamera.trim()}
                >
                  {cameras.length === 0 ? (
                    <>
                      <input
                        className={control}
                        value={newCamera}
                        onChange={(e) => setNewCamera(e.target.value)}
                        placeholder="Название камеры, например Pentax 155g"
                        autoComplete="off"
                      />
                      <p className="mt-1 text-xs text-ink-faint">
                        Камеры у вас ещё нет: она сохранится вместе с плёнкой и
                        появится в списке
                      </p>
                    </>
                  ) : (
                    <>
                      <Select
                        value={cameraId}
                        onChange={(e) => pickCamera(e.target.value)}
                      >
                        {cameras.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        <option value={NEW}>＋ Добавить камеру…</option>
                      </Select>
                      {addingCamera ? (
                        <Inline
                          value={newCamera}
                          onChange={setNewCamera}
                          onSave={saveCamera}
                          onCancel={() => setAddingCamera(false)}
                          placeholder="Название камеры"
                        />
                      ) : (
                        <p className="mt-1 text-xs text-ink-faint">
                          Последняя выбранная запоминается
                        </p>
                      )}
                    </>
                  )}
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Месяц начала съёмки">
                    <Select
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Год">
                    <Select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                    >
                      {Array.from(
                        { length: 12 },
                        (_, i) => now.getFullYear() - i,
                      ).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field
                  label="Описание"
                  hint="Здесь же можно написать место, поездку или что плёнка снималась дольше месяца"
                >
                  <textarea
                    className={`${control} min-h-24 resize-y`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </section>
          <div className="hidden lg:block">{actions}</div>
        </div>

        {/* ── кадры ── */}
        <section aria-label="Кадры" className="min-w-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center rounded-[3px] border-2 border-dashed px-6 text-center transition-colors ${
              items.length ? "py-6" : "py-16"
            } ${drag ? "border-accent bg-accent/5" : "border-line bg-paper-light/60"}`}
          >
            <UploadIcon width={28} height={28} className="text-ink-faint" />
            <p className="mt-2 text-lg text-ink-soft">
              Перетащите папку или файлы сюда
            </p>
            <p className="mt-1 text-sm text-ink-faint">
              Папка подскажет плёнку, ISO и дату по своему названию, для
              отдельных файлов поля заполняются вручную
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => folderInput.current?.click()}
                className={ghost}
              >
                Выбрать папку
              </button>
              <label className={`${ghost} cursor-pointer`}>
                Выбрать файлы
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => onPick(e, false)}
                />
              </label>
              <input
                ref={folderInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => onPick(e, true)}
              />
              <button
                type="button"
                aria-expanded={linkOpen}
                onClick={() => setLinkOpen((v) => !v)}
                className={ghost}
              >
                По ссылке с Яндекс Диска
              </button>
            </div>

            {linkOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void findByLink();
                }}
                className="mt-4 flex w-full max-w-xl flex-wrap justify-center gap-2 text-left"
              >
                <input
                  className={`${control} min-w-0 flex-1 basis-64`}
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://disk.yandex.ru/d/…"
                  inputMode="url"
                  autoComplete="off"
                  aria-label="Публичная ссылка на Яндекс Диск"
                />
                <button
                  type="submit"
                  disabled={linkBusy || !linkUrl.trim()}
                  className={`${ghost} disabled:opacity-40`}
                >
                  {linkBusy ? "Ищем…" : "Найти кадры"}
                </button>
                <p className="basis-full text-center text-xs text-ink-faint">
                  Публичная ссылка на папку или файл. Кадры скачает сам сервер,
                  вкладку можно будет закрыть.
                </p>
                {linkError && (
                  <p
                    className="basis-full text-center text-sm text-accent"
                    role="alert"
                  >
                    {linkError}
                  </p>
                )}
              </form>
            )}
          </div>

          {link && (
            <p
              className="mt-3 rounded-[3px] bg-paper-deep px-3 py-2 text-sm text-ink-soft"
              role="status"
            >
              Яндекс Диск, «{link.name}»: кадров {items.length}
              {link.skipped > 0 && `, пропущено не картинок: ${link.skipped}`}
              {link.tooBig > 0 && `, слишком больших: ${link.tooBig}`}.
              {importId &&
                items.some(
                  (i) => i.status === "queued" || i.status === "uploading",
                ) &&
                (shown > 0
                  ? " Кадры уже в папке, оригиналы докачиваются. Вкладку можно закрыть."
                  : " Кадры скачивает сервер: вкладку можно закрыть, импорт продолжится.")}
              {importId && uploaded && !finished && (
                <>
                  {" "}
                  <Link
                    href={`/rolls/${uploaded.rollId}`}
                    className="text-accent underline underline-offset-4"
                  >
                    Открыть папку
                  </Link>
                </>
              )}
            </p>
          )}

          {hint && (
            <p
              className="mt-3 rounded-[3px] bg-paper-deep px-3 py-2 text-sm text-ink-soft"
              role="status"
            >
              Папка «{hint.folder}»:{" "}
              {hint.found.length ? (
                <>
                  заполнили по названию — {hint.found.join(", ")}. Проверьте и
                  поправьте, если нужно.
                </>
              ) : (
                "по названию ничего не распознали, заполните поля вручную."
              )}
            </p>
          )}

          {items.length > 0 && (
            <>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-sm text-ink-soft" aria-live="polite">
                  {!started
                    ? `Кадров: ${total}`
                    : importId
                      ? `В папке ${shown} из ${total} · оригиналы ${done} из ${total}`
                      : `Загружено ${done} из ${total}`}
                  {failed > 0 && (
                    <span className="text-accent"> · не удалось: {failed}</span>
                  )}
                </p>
                {started && (
                  <div
                    className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-paper-edge"
                    role="progressbar"
                    aria-valuenow={Math.round(overall)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full bg-ink transition-[width] duration-150"
                      style={{ width: `${overall}%` }}
                    />
                  </div>
                )}
                {errors.length > 0 && (
                  <p className="basis-full text-sm text-accent">
                    {errors.join("; ")}
                  </p>
                )}
                {failed > 0 && (
                  <button
                    type="button"
                    onClick={retryAll}
                    className="flex items-center gap-1.5 text-sm text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
                  >
                    <RetryIcon width={14} height={14} /> Повторить все
                  </button>
                )}
              </div>

              <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                {items.map((i) => (
                  <li
                    key={i.id}
                    className="relative aspect-square overflow-hidden rounded-frame bg-paper-deep ring-1 ring-line"
                    title={`${i.name} · ${(i.size / 1048576).toFixed(1)} МБ${i.error ? ` · ${i.error}` : ""}`}
                  >
                    {i.url ? (
                      // миниатюры с Диска Яндекс отдаёт только без Referer чужого сайта (иначе 403), поэтому не отправляем его
                      <Image
                        src={i.url}
                        alt=""
                        fill
                        unoptimized
                        referrerPolicy="no-referrer"
                        // картинка не показалась (Яндекс не смог сделать миниатюру, браузер не умеет HEIC):
                        // плитка покажет название файла, как кадр без миниатюры
                        onError={() => setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, url: undefined } : x)))}
                        sizes="120px"
                        className={`object-cover transition-opacity ${i.status === "done" || i.shown || !started ? "opacity-100" : "opacity-60"}`}
                      />
                    ) : (
                      // кадр по ссылке без миниатюры
                      <span className="absolute inset-0 grid place-items-center break-all p-1.5 text-center text-[10px] leading-tight text-ink-faint">
                        {i.name}
                      </span>
                    )}
                    {started && i.status !== "done" && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/15">
                        <div
                          className={`h-full ${i.status === "error" ? "bg-accent" : "bg-ink"}`}
                          style={{ width: `${i.progress}%` }}
                        />
                      </div>
                    )}
                    {i.status === "done" && (
                      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-paper/90 text-ink shadow-sm">
                        <CheckIcon width={12} height={12} />
                      </span>
                    )}
                    {i.status === "error" && (
                      <button
                        type="button"
                        onClick={() => retry(i.id)}
                        className="absolute inset-0 grid place-items-center bg-paper/85 text-accent"
                        aria-label={`Повторить загрузку ${i.name}`}
                      >
                        <span className="flex flex-col items-center gap-1 text-[11px]">
                          <RetryIcon width={18} height={18} />
                          Повторить
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="lg:hidden">{actions}</div>
        </section>
      </div>
    </div>
  );
}

const ghost =
  "rounded-control px-4 py-2 text-sm text-ink ring-1 ring-ink/40 transition-colors hover:bg-ink hover:text-paper";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span
        className={`mb-1 block text-[11px] uppercase tracking-[0.12em] ${error ? "text-accent" : "text-ink-faint"}`}
      >
        {label}
      </span>
      <label className="block">{children}</label>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function Inline({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder: string;
}) {
  return (
    <span className="mt-2 flex gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className={control}
      />
      <button
        type="button"
        onClick={onSave}
        className="rounded-control bg-ink px-4 text-sm text-paper"
      >
        Добавить
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-1 text-sm text-ink-soft hover:text-ink"
      >
        Отмена
      </button>
    </span>
  );
}

/** Файлы из перетаскивания: обходит вложенные папки; если бросили одну папку, отдаёт её название */
async function collect(
  dt: DataTransfer,
): Promise<{ files: File[]; folder: string | null }> {
  type Entry = FileSystemEntry | null;
  const entries = [...dt.items]
    .filter((i) => i.kind === "file")
    .map((i): Entry => i.webkitGetAsEntry?.() ?? null);
  if (!entries.length || entries.some((e) => !e))
    return { files: [...dt.files], folder: null };

  const files: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      files.push(
        await new Promise<File>((res, rej) =>
          (e as FileSystemFileEntry).file(res, rej),
        ),
      );
      return;
    }
    const reader = (e as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej),
      );
      if (!batch.length) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const e of entries) await walk(e!);
  const folder =
    entries.length === 1 && entries[0]!.isDirectory ? entries[0]!.name : null;
  return { files, folder };
}
