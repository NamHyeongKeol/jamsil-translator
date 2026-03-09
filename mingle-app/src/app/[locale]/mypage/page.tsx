import MyPage from "@/components/my-page";
import { getDictionary, isSupportedLocale } from "@/i18n";
import { getUserPreferredLocale } from "@/lib/user-preferred-locale";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth-options";

type MyPageRouteProps = {
  params: Promise<{
    locale: string;
  }>;
};

export default async function MyPageRoute({ params }: MyPageRouteProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const session = await getServerSession(getAuthOptions());
  if (!session) {
    redirect(`/${locale}`);
  }

  const preferredLocale = await getUserPreferredLocale(session.user.id);
  if (preferredLocale && preferredLocale !== locale) {
    redirect(`/${preferredLocale}/mypage`);
  }

  return <MyPage locale={locale} dictionary={getDictionary(locale)} />;
}
