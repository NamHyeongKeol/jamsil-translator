import MingleHome from "@/components/mingle-home";
import { DEFAULT_LOCALE, getDictionary } from "@/i18n";
import { isAppleOAuthConfigured, isGoogleOAuthConfigured } from "@/lib/auth-options";

export default function Page() {
  const locale = DEFAULT_LOCALE;
  const dictionary = getDictionary(locale);

  return (
    <MingleHome
      dictionary={dictionary}
      appleOAuthEnabled={isAppleOAuthConfigured()}
      googleOAuthEnabled={isGoogleOAuthConfigured()}
      locale={locale}
    />
  );
}
