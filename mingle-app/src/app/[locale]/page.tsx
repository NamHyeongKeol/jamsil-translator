import MingleHome from "@/components/mingle-home";
import { getDictionary, isSupportedLocale } from "@/i18n";
import { getAuthOptions, isAppleOAuthConfigured, isGoogleOAuthConfigured } from "@/lib/auth-options";
import { getUserPreferredLocale } from "@/lib/user-preferred-locale";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

type LocalePageProps = {
  params: Promise<{
    locale: string;
  }>;
};

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const session = await getServerSession(getAuthOptions());
  if (session?.user) {
    const preferredLocale = await getUserPreferredLocale(session.user.id);
    redirect(`/${preferredLocale ?? locale}/conversations`);
  }

  return (
    <MingleHome
      dictionary={getDictionary(locale)}
      appleOAuthEnabled={isAppleOAuthConfigured()}
      googleOAuthEnabled={isGoogleOAuthConfigured()}
      locale={locale}
    />
  );
}
