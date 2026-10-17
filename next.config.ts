import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Открытые за последние 30 секунд страницы при возврате показываются из памяти браузера, без запроса к серверу:
    // переходы «Лента ↔ Папки» мгновенные, даже когда канал занят загрузкой фото. Правки и удаление (revalidatePath)
    // и обновление страницы окном загрузки (router.refresh) эту память сбрасывают
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
