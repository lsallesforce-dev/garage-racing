import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Garage Racing | Inteligência Automotiva',
  description: 'Análise de estoque com precisão de engenharia e IA.',
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
        {children}
      </body>
    </html>
  );
}
