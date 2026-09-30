import type { Metadata, Viewport } from "next";
import { Anton, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import SiteHeader from "./components/SiteHeader";
import BottomBarNav from "./components/BottomBarNav";
import { FRAMES, ROLLS } from "@/lib/catalog";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  const hasFrames = FRAMES.length > 0;

  return (
    <html lang="ru" className={`${plex.variable} ${anton.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader hasFrames={hasFrames} rollCount={ROLLS.length} />
        <main className="flex-1">{children}</main>
        <BottomBarNav hasFrames={hasFrames} rollCount={ROLLS.length} />
      </body>
    </html>
  );
}
