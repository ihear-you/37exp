import { redirect } from "next/navigation";
import Feed from "../components/Feed";
import WelcomeReel from "../components/WelcomeReel";
import { configuredProviders } from "@/lib/auth/providers";
import { getViewer } from "@/lib/auth/session";
import { getMyFeedFrames, getMyRollViews } from "@/lib/db";
import { getEditorialPhotos } from "@/lib/editorial";

// Почему не удался вход: сервис входа возвращает сюда с ?login=<причина> (app/api/auth/[provider]/callback)
const LOGIN_ERRORS: Record<string, string> = {
  config: "Вход ещё не настроен: нет ключей Яндекса или Google (см. README).",
  denied: "Вход отменён.",
  state: "Не удалось завершить вход, попробуйте ещё раз.",
  provider: "Не удалось получить данные от сервиса входа, попробуйте ещё раз.",
  email: "Сервис входа не передал почту: проверьте, что у приложения включён доступ к адресу электронной почты.",
};

export default async function FeedPage({ searchParams }: PageProps<"/">) {
  const viewer = await getViewer();

  // без входа: заставка с одной кнопкой «Войти» (у пустой ленты вошедшего она же, но с «Загрузить»)
  if (!viewer) {
    const { login } = await searchParams;
    const loginError = typeof login === "string" ? (LOGIN_ERRORS[login] ?? LOGIN_ERRORS.provider) : undefined;
    return <WelcomeReel photos={await getEditorialPhotos()} signIn={configuredProviders()} loginError={loginError} />;
  }

  const [frames, rolls] = await Promise.all([getMyFeedFrames(viewer.id), getMyRollViews(viewer.id)]);
  // плёнок нет (первый вход или все удалили): сразу к выбору, откуда взять кадры (UploadSources на странице папок).
  // Плёнки есть, а кадров нет — лента покажет заглушку (Feed)
  if (rolls.length === 0) redirect("/rolls");
  return <Feed frames={frames} rolls={Object.fromEntries(rolls.map((r) => [r.id, r]))} />;
}
