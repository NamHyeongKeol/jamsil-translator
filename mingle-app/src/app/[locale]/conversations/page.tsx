import ConversationList from "@/components/conversation-list";
import { isSupportedLocale } from "@/i18n";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth-options";

type ConversationsPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function ConversationsPage({ params }: ConversationsPageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const session = await getServerSession(getAuthOptions());
  if (!session) {
    redirect(`/${locale}`);
  }

  return <ConversationList locale={locale} />;
}
