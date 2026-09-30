import WelcomeReel from "../components/WelcomeReel";
import { getEditorialPhotos } from "@/lib/unsplash";

/** Служебная страница: посмотреть анимацию пустой ленты, не опустошая настоящую. Дев-инструмент. */
export default async function PreviewWelcomePage() {
  const photos = await getEditorialPhotos();
  return <WelcomeReel photos={photos} />;
}
