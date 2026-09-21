import type { Metadata } from "next";
import UploadPrototype from "../components/UploadPrototype";

export const metadata: Metadata = { title: "Загрузка · plenka" };

export default function UploadPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-20 pt-6 md:px-5 md:pt-8">
      <h1 className="font-display text-[26px] leading-tight md:text-[36px]">Загрузка плёнки</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">
        В прототипе кадры никуда не отправляются: форма и прогресс показывают, как это будет выглядеть.
      </p>
      <div className="mt-8 md:mt-10">
        <UploadPrototype />
      </div>
    </div>
  );
}
