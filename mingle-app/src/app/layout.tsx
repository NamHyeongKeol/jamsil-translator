import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import MobileCanvasShell from "@/components/mobile-canvas-shell";
import { DEFAULT_LOCALE } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mingle",
  description: "Real-time translation service",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1.0,
  userScalable: false,
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
