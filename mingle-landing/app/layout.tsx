import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mingle, Seamless Translator',
  description: 'Just stay in the conversation. Mingle lets you talk without translating sentence by sentence.',
  openGraph: {
    title: 'Mingle, Seamless Translator',
    description: 'Just stay in the conversation. Mingle lets you talk without translating sentence by sentence.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Mingle - Seamless Translator',
      },
    ],
    type: 'website',
    siteName: 'Mingle',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mingle, Seamless Translator',
    description: 'Just stay in the conversation. Mingle lets you talk without translating sentence by sentence.',
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
