import Feed from "./components/Feed";
import { FRAMES, rollViewsById } from "@/lib/catalog";

export default function FeedPage() {
  return <Feed frames={FRAMES} rolls={rollViewsById()} />;
}
