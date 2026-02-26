import MingleHome from "@/components/mingle-home";
import { getDictionary, isSupportedLocale } from "@/i18n";
import { isAppleOAuthConfigured, isGoogleOAuthConfigured } from "@/lib/auth-options";
import { notFound } from "next/navigation";

type TranslatorPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

export default async function TranslatorPage({ params }: TranslatorPageProps) {
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
