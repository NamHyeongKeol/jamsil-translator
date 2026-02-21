import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { isSupportedLocale } from "@/i18n";

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

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(`/${locale}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-[40rem] bg-[#f8fafc] px-6 py-10 text-slate-900">
      <h1 className="mb-2 text-2xl font-semibold">Account</h1>
      <p className="mb-6 text-sm text-slate-600">
        보호 라우트 검증을 위한 계정 페이지입니다.
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-1 text-sm text-slate-500">Name</p>
        <p className="mb-4 text-base font-medium">{session.user.name ?? "Unknown user"}</p>
        <p className="mb-1 text-sm text-slate-500">Email</p>
        <p className="text-base font-medium">{session.user.email ?? "No email"}</p>
      </section>

      <Link
        className="mt-6 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        href={`/${locale}`}
      >
        홈으로 돌아가기
      </Link>
    </main>
  );
}
