"use client";

import { useSyncExternalStore } from "react";

// Маленькое хранилище поверх sessionStorage / localStorage.
// На сервере и при первой отрисовке отдаёт запасное значение, поэтому гидрация не расходится.

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | T): void;
  subscribe(cb: () => void): () => void;
}

export function createStore<T extends object>(
  key: string,
  kind: "session" | "local",
  init: () => T,
): Store<T> {
  let cache: T | undefined;
  const listeners = new Set<() => void>();
  const area = () => (kind === "session" ? window.sessionStorage : window.localStorage);

  const save = (v: T) => {
    try {
      area().setItem(key, JSON.stringify(v));
    } catch {
      // хранилище недоступно, значение живёт до перезагрузки
    }
  };

  return {
    get() {
      if (cache) return cache;
      let v: T | undefined;
      try {
        const raw = area().getItem(key);
        if (raw) v = { ...init(), ...JSON.parse(raw) };
      } catch {
        // повреждённое значение игнорируем
      }
      if (!v) {
        v = init();
        save(v);
      }
      cache = v;
      return v;
    },
    set(patch) {
      cache = { ...this.get(), ...patch };
      save(cache);
      listeners.forEach((l) => l());
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Значение из хранилища, а пока страница не гидрирована, `fallback` */
export function useStore<T extends object, F = null>(store: Store<T>, fallback: F = null as F): T | F {
  return useSyncExternalStore<T | F>(store.subscribe, store.get, () => fallback);
}
