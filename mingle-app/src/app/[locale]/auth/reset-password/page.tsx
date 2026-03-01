import ResetPasswordForm from "@/components/auth/reset-password-form";
import { getDictionary, isSupportedLocale } from "@/i18n";
import { notFound } from "next/navigation";

type ResetPasswordPageProps = {
  params: Promise<{
    locale: string;
  }>;
  searchParams: Promise<{
    token?: string | string[];
  }>;
};

function takeFirst(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

export default async function ResetPasswordPage({ params, searchParams }: ResetPasswordPageProps) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const query = await searchParams;
  const token = takeFirst(query.token).trim();
  if (!token) {
    notFound();
  }

  return (
    <ResetPasswordForm
      dictionary={getDictionary(locale)}
      locale={locale}
      token={token}
    />
  );
}

