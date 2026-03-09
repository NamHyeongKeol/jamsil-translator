import MyPage from "@/components/my-page";
import { getDictionary, isSupportedLocale } from "@/i18n";
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

  // dictionary를 사용하지 않더라도 향후 확장을 위해 로드
  getDictionary(locale);

  return <MyPage locale={locale} />;
}
