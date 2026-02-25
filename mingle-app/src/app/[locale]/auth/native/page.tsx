import { redirect } from "next/navigation";
import NativeOAuthLauncher from "@/components/native-oauth-launcher";
import { isSupportedLocale } from "@/i18n";

type NativeOAuthProvider = "apple" | "google";

type NativeOAuthLaunchPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    provider?: string | string[];
    callbackUrl?: string | string[];
  }>;
};

function takeFirst(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function resolveProvider(rawValue: string): NativeOAuthProvider | null {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "google" || normalized === "apple") {
    return normalized;
  }
  return null;
}

export default async function NativeOAuthLaunchPage({
  params,
  searchParams,
}: NativeOAuthLaunchPageProps) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    redirect("/");
  }

  const query = await searchParams;
  const provider = resolveProvider(takeFirst(query.provider));
  const callbackUrl = takeFirst(query.callbackUrl).trim();
  if (!provider || !callbackUrl) {
    redirect(`/${locale}`);
  }

  return (
    <NativeOAuthLauncher
      locale={locale}
      provider={provider}
      callbackUrl={callbackUrl}
    />
  );
}
