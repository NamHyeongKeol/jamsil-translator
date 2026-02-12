import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mingle",
  description: "Real-time translation service",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
