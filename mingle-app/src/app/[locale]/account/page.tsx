import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth-options";
import { getDictionary, isSupportedLocale } from "@/i18n";

type AccountPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

export default async function AccountPage({ params }: AccountPageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    redirect("/");
  }

  const session = await getServerSession(getAuthOptions());
  if (!session?.user) {
    redirect(`/${locale}`);
  }
  const dictionary = getDictionary(locale);

  return (
    <main className="mx-auto min-h-screen max-w-[40rem] bg-[#f8fafc] px-6 py-10 text-slate-900">
      <h1 className="mb-2 text-2xl font-semibold">{dictionary.account.title}</h1>
      <p className="mb-6 text-sm text-slate-600">
        {dictionary.account.description}
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-1 text-sm text-slate-500">{dictionary.account.nameLabel}</p>
        <p className="mb-4 text-base font-medium">
          {session.user.name ?? dictionary.account.unknownUser}
        </p>
        <p className="mb-1 text-sm text-slate-500">{dictionary.account.emailLabel}</p>
        <p className="text-base font-medium">
          {session.user.email ?? dictionary.account.noEmail}
        </p>
      </section>

      <Link
        className="mt-6 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        href={`/${locale}`}
      >
        {dictionary.account.backHome}
      </Link>
    </main>
  );
}
