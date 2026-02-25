import MingleHome from "@/components/mingle-home";
import { getDictionary, isSupportedLocale } from "@/i18n";
import { notFound } from "next/navigation";
import { isAppleOAuthConfigured, isGoogleOAuthConfigured } from "@/lib/auth-options";

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

  return (
    <MingleHome
      dictionary={getDictionary(locale)}
      appleOAuthEnabled={isAppleOAuthConfigured()}
      googleOAuthEnabled={isGoogleOAuthConfigured()}
      locale={locale}
    />
  );
}
