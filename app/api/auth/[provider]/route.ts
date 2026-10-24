import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, safeNext, secureCookies } from "@/lib/auth/config";
import { getProvider, isProvider } from "@/lib/auth/providers";

// Начало входа: запоминаем state (и PKCE-проверку для Google) в cookie и отправляем к провайдеру
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: id } = await params;
  if (!isProvider(id)) return new Response(null, { status: 404 });
  const provider = getProvider(id);
  if (!provider.configured()) return NextResponse.redirect(`${appUrl()}/?login=config`);

  const state = generateState();
  const verifier = generateCodeVerifier();
  const next = safeNext(new URL(request.url).searchParams.get("next"));

  const store = await cookies();
  const options = { httpOnly: true, secure: secureCookies(), sameSite: "lax" as const, path: "/api/auth", maxAge: 600 };
  store.set("oauth_state", state, options);
  store.set("oauth_verifier", verifier, options);
  store.set("oauth_next", next, options);

  return NextResponse.redirect(provider.authorizationUrl(state, verifier));
}
