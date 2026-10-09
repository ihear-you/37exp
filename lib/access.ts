import { timingSafeEqual } from "node:crypto";
import type { Visibility } from "./catalog";

// Кто может видеть плёнку (и её кадры). Одно правило на весь сайт: его применяют и страницы, и выдача файлов.
//  - автор видит всё своё;
//  - «открыта всем» видит любой;
//  - «по ссылке» видит тот, кто пришёл по ссылке с ключом (/s/<ключ>, ключи запоминаются в cookie зрителя):
//    в списках такая плёнка не видна;
//  - «только я» не видит никто, кроме автора. Для остальных такой плёнки как будто нет (404).

export interface Access {
  ownerId: number;
  visibility: Visibility;
  shareKey: string | null;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** keys: ключи ссылок, которые есть у зрителя */
export function canView(roll: Access, viewerId: number | null, keys: readonly string[]): boolean {
  if (viewerId !== null && viewerId === roll.ownerId) return true;
  if (roll.visibility === "public") return true;
  if (roll.visibility === "link" && roll.shareKey) return keys.some((k) => same(k, roll.shareKey!));
  return false;
}
