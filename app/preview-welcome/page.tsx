import WelcomeReel from "../components/WelcomeReel";
import { configuredProviders } from "@/lib/auth/providers";
import { getEditorialPhotos } from "@/lib/editorial";

/** Служебная страница: посмотреть анимацию пустой ленты, не опустошая настоящую. Дев-инструмент.
 * /preview-welcome — как видит вошедший с пустым архивом, /preview-welcome?guest — как видит гость. */
export default async function PreviewWelcomePage({ searchParams }: PageProps<"/preview-welcome">) {
  const photos = await getEditorialPhotos();
  const guest = (await searchParams).guest !== undefined;
  return <WelcomeReel photos={photos} signIn={guest ? configuredProviders() : undefined} />;
}
