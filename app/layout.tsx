import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-JWDYTSV7TT';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.autozap.digital').replace(/\/+$/, '');

const DESCRICAO =
  'Plataforma com IA que atende seus leads no WhatsApp 24/7, gera vídeos e vitrine do estoque, anuncia em Webmotors, OLX e Meta e organiza o financeiro da sua revenda de veículos.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'AutoZap — Sistema de IA para revendas de veículos',
    // Páginas internas viram "Sobre | AutoZap", "Planos | AutoZap" etc.
    template: '%s | AutoZap',
  },
  description: DESCRICAO,
  applicationName: 'AutoZap',
  keywords: [
    'sistema para revenda de carros',
    'CRM para revenda de veículos',
    'atendimento automático no WhatsApp',
    'IA para revenda de carros',
    'anunciar carro em vários sites',
    'gestão de revenda de veículos',
    'automação de WhatsApp para concessionária',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: SITE_URL,
    siteName: 'AutoZap',
    title: 'AutoZap — Sistema de IA para revendas de veículos',
    description: DESCRICAO,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AutoZap — Sistema de IA para revendas de veículos',
    description: DESCRICAO,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-screen text-gray-900 selection:bg-red-100 selection:text-red-900">
        {/* Google tag (gtag.js) */}
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
        </Script>
        {children}
      </body>
    </html>
  );
}
