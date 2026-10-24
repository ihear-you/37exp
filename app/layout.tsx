import type { Metadata, Viewport } from "next";
import { Anton, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import SiteHeader from "./components/SiteHeader";
import BottomBarNav from "./components/BottomBarNav";
import UploadIndicator from "./components/UploadIndicator";
import { configuredProviders } from "@/lib/auth/providers";
import { getViewer } from "@/lib/auth/session";
import { getMyCounts } from "@/lib/db";

// IBM Plex Sans: единственный шрифт текста на сайте — интерфейс, заголовки, названия плёнок.
const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin", "cyrillic"],
  weight: "400",
});

// Anton: только логотип «[37exp]». Только латиница и цифры — кириллицы в этом шрифте нет,
// поэтому для русских заголовков (названия плёнок и т.д.) он не используется.
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "[37exp]: архив плёночных кадров",
  description: "Плёночные кадры одной лентой и по папкам.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // кадры и плёнки в шапке: свои у вошедшего, а зритель без входа ничего своего не имеет
  const viewer = await getViewer();
  const counts = viewer ? await getMyCounts(viewer.id) : { rolls: 0, frames: 0 };
  // архив есть, если есть хоть одна плёнка, пусть и без кадров: тогда навигация видна (лента покажет заглушку)
  const hasArchive = counts.rolls > 0 || counts.frames > 0;

  return (
    <html lang="ru" className={`${plex.variable} ${anton.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader
          hasArchive={hasArchive}
          rollCount={counts.rolls}
          user={viewer ? { name: viewer.name, avatarUrl: viewer.avatarUrl } : null}
          signIn={viewer ? null : (configuredProviders()[0] ?? null)}
        />
        <main className="flex-1">{children}</main>
        <BottomBarNav hasArchive={hasArchive} rollCount={counts.rolls} />
        {/* ход фоновых загрузок: из формы можно уйти, загрузка продолжится (lib/upload-queue.ts) */}
        <UploadIndicator />
      </body>
    </html>
  );
}
