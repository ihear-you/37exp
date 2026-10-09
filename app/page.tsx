import Feed from "./components/Feed";
import WelcomeReel from "./components/WelcomeReel";
import { getViewer } from "@/lib/auth/session";
import { getMyFeedFrames, getMyRollViews } from "@/lib/db";
import { getEditorialPhotos } from "@/lib/unsplash";

export default async function FeedPage() {
  const viewer = await getViewer();

  // без входа: заставка (та же, что у пустой ленты), «Загрузить» ведёт на вход
  if (!viewer) return <WelcomeReel photos={await getEditorialPhotos()} />;

  const [frames, rolls] = await Promise.all([getMyFeedFrames(viewer.id), getMyRollViews(viewer.id)]);
  // фото Unsplash нужны только пустой ленте (заставка); с кадрами их не запрашиваем
  const photos = frames.length === 0 ? await getEditorialPhotos() : [];
  return <Feed frames={frames} rolls={Object.fromEntries(rolls.map((r) => [r.id, r]))} photos={photos} />;
}
