import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import MobileCanvasShell from "@/components/mobile-canvas-shell";
import { TtsSettingsProvider } from "@/context/tts-settings";
import { DEFAULT_LOCALE } from "@/i18n";
import "./globals.css";

function toMetadataBaseUrl(raw?: string): URL | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(normalized);
  } catch {
    return undefined;
  }
}

const metadataBase =
  toMetadataBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
  toMetadataBaseUrl(process.env.NEXTAUTH_URL) ??
  toMetadataBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
  toMetadataBaseUrl(process.env.VERCEL_URL);

export const metadata: Metadata = {
  metadataBase,
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
      <head>
        {/* <head> 파싱 시 동기 실행 → body 렌더 전에 zoom <style> 주입 → flash 없음 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var STYLE_ID='__mingle_canvas_zoom';
  var w=window.innerWidth;
  if(w>0&&w<400){
    var z=w/400;
    var s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent='.mobile-canvas-shell{zoom:'+z+' !important;height:calc(100svh/'+z+') !important;min-height:calc(100svh/'+z+') !important}';
    document.head.appendChild(s);
  }
})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <TtsSettingsProvider>
          <AuthSessionProvider>
            <MobileCanvasShell>{children}</MobileCanvasShell>
          </AuthSessionProvider>
        </TtsSettingsProvider>
      </body>
    </html>
  );
}
