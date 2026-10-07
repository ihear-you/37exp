import type { Metadata } from "next";
import BackButton from "../components/BackButton";
import UploadPrototype from "../components/UploadPrototype";

export const metadata: Metadata = { title: "Загрузка · [37exp]" };

export default function UploadPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-20 pt-6 md:px-5 md:pt-8">
      <div className="mb-4">
        <BackButton />
      </div>
      <UploadPrototype />
    </div>
  );
}
