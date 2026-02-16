import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import MobileCanvasShell from "@/components/mobile-canvas-shell";
import { DEFAULT_LOCALE } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mingle, Seamless Translator",
  description: "Just stay in the conversation. Mingle lets you talk without translating sentence by sentence.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Mingle, Seamless Translator",
    description: "Just stay in the conversation. Mingle lets you talk without translating sentence by sentence.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Mingle - Seamless Translator",
      },
    ],
    type: "website",
    siteName: "Mingle",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mingle, Seamless Translator",
    description: "Just stay in the conversation. Mingle lets you talk without translating sentence by sentence.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1.0,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="antialiased">
        <AuthSessionProvider>
          <MobileCanvasShell>{children}</MobileCanvasShell>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
