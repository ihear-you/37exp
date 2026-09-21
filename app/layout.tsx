import type { Metadata, Viewport } from "next";
import { PT_Mono } from "next/font/google";
import "./globals.css";
import SiteHeader from "./components/SiteHeader";

// У PT Mono одно начертание: без жирного и курсива
const ptMono = PT_Mono({
  variable: "--font-pt-mono",
  subsets: ["latin", "cyrillic"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "plenka: архив плёночных кадров",
  description: "Плёночные кадры одной лентой и по папкам.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={ptMono.variable}>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
