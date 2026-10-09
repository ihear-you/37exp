import { NextResponse } from "next/server";
import { appUrl } from "@/lib/auth/config";
import { isShareKey, rememberShareKey } from "@/lib/auth/shares";
import { getRollByShareKey } from "@/lib/db";

// Вход по ссылке «все, у кого есть ссылка»: запоминаем ключ у зрителя и открываем плёнку.
// Если плёнку с тех пор закрыли («только я») или ключа нет, отвечаем 404.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isShareKey(key)) return new Response(null, { status: 404 });
  const roll = await getRollByShareKey(key);
  if (!roll || roll.visibility === "private") return new Response(null, { status: 404 });

  await rememberShareKey(key);
  return NextResponse.redirect(`${appUrl()}/rolls/${roll.id}`);
}
