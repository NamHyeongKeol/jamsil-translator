import { notFound } from "next/navigation";
import MingleHome from "@/components/mingle-home";
import { getDictionary, isSupportedLocale } from "@/i18n";

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

  const dictionary = getDictionary(locale);

  return <MingleHome dictionary={dictionary} locale={locale} />;
}
