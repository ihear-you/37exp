import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, isOwnerEmail, safeNext } from "@/lib/auth/config";
import { getProvider, isProvider } from "@/lib/auth/providers";
import { startSession } from "@/lib/auth/session";
import { findOrCreateOAuthUser } from "@/lib/db";

// Возврат от провайдера: сверяем state, меняем код на профиль и заводим сессию
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const fail = (reason: string) => NextResponse.redirect(`${appUrl()}/?login=${reason}`);

  const { provider: id } = await params;
  if (!isProvider(id)) return new Response(null, { status: 404 });
  const provider = getProvider(id);
  if (!provider.configured()) return fail("config");

  const query = new URL(request.url).searchParams;
  if (query.get("error")) return fail("denied");

  const store = await cookies();
  const state = store.get("oauth_state")?.value;
  const verifier = store.get("oauth_verifier")?.value;
  const next = safeNext(store.get("oauth_next")?.value);
  const code = query.get("code");
  for (const name of ["oauth_state", "oauth_verifier", "oauth_next"]) store.delete(name);

  if (!code || !state || !verifier || query.get("state") !== state) return fail("state");

  let profile;
  try {
    profile = await provider.fetchProfile(code, verifier);
  } catch {
    return fail("provider");
  }
  if (!profile) return fail("email");

  const user = await findOrCreateOAuthUser(profile, isOwnerEmail(profile.email));
  await startSession(user.id);
  // Впервые пришёл — значит, хочет завести свой архив: сразу к пустому состоянию с плитками загрузки, даже если
  // нажал «Войти» на чужой плёнке. Аккаунт уже был — обратно туда, откуда входил
  return NextResponse.redirect(`${appUrl()}${user.created ? "/rolls" : next}`);
}
