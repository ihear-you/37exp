import type { MetadataRoute } from "next";

// Сайт можно вынести на экран телефона: открывается со своей иконкой и без адресной строки.
// Работы без интернета нет, кадры всё равно приходят с сервера. iPhone читает отсюда не всё: см. appleWebApp в layout.tsx
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Плёнка",
    short_name: "Плёнка",
    description: "Плёночные кадры одной лентой и по папкам.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
