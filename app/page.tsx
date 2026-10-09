import Feed from "./components/Feed";
import WelcomeReel from "./components/WelcomeReel";
import { getViewer } from "@/lib/auth/session";
import { getMyFeedFrames, getMyRollViews } from "@/lib/db";
import { getEditorialPhotos } from "@/lib/unsplash";

export default async function FeedPage() {
  const [viewer, photos] = await Promise.all([getViewer(), getEditorialPhotos()]);

  // без входа: заставка (та же, что у пустой ленты), «Загрузить» ведёт на вход
  if (!viewer) return <WelcomeReel photos={photos} />;

  const [frames, rolls] = await Promise.all([getMyFeedFrames(viewer.id), getMyRollViews(viewer.id)]);
  return <Feed frames={frames} rolls={Object.fromEntries(rolls.map((r) => [r.id, r]))} photos={photos} />;
}
