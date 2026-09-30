import Feed from "./components/Feed";
import { FRAMES, rollViewsById } from "@/lib/catalog";
import { getEditorialPhotos } from "@/lib/unsplash";

export default async function FeedPage() {
  const photos = await getEditorialPhotos();
  return <Feed frames={FRAMES} rolls={rollViewsById()} photos={photos} />;
}
