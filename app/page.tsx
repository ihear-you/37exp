import { redirect } from "next/navigation";
import Feed from "./components/Feed";
import WelcomeReel from "./components/WelcomeReel";
import { configuredProviders } from "@/lib/auth/providers";
import { getViewer } from "@/lib/auth/session";
import { getMyFeedFrames, getMyRollViews } from "@/lib/db";
import { getEditorialPhotos } from "@/lib/unsplash";

export default async function FeedPage() {
  const viewer = await getViewer();

  // без входа: заставка с одной кнопкой «Войти» (у пустой ленты вошедшего она же, но с «Загрузить»)
  if (!viewer) return <WelcomeReel photos={await getEditorialPhotos()} signIn={configuredProviders()} />;

  const [frames, rolls] = await Promise.all([getMyFeedFrames(viewer.id), getMyRollViews(viewer.id)]);
  // плёнок ещё нет (первый вход): сразу к выбору, откуда взять кадры (EmptyArchive на странице папок)
  if (rolls.length === 0) redirect("/rolls");
  // фото Unsplash нужны только пустой ленте (заставка); с кадрами их не запрашиваем
  const photos = frames.length === 0 ? await getEditorialPhotos() : [];
  return <Feed frames={frames} rolls={Object.fromEntries(rolls.map((r) => [r.id, r]))} photos={photos} />;
}
