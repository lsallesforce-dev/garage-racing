import type { Metadata } from "next";
import Link from "next/link";
import { Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "AutoZap — IA para Revendas de Veículos",
  description:
    "Transforme sua revenda com inteligência artificial. Leads qualificados no WhatsApp, vídeos de marketing gerados por IA e gestão completa do pátio.",
  openGraph: {
    title: "AutoZap — IA para Revendas de Veículos",
    description:
      "Automatize leads, gere vídeos e venda mais. O sistema de IA para revendas que trabalha enquanto você dorme.",
    siteName: "AutoZap",
  },
};

const navLinks = [
  { href: "/portal#funcionalidades", label: "Funcionalidades" },
  { href: "/portal/sobre",           label: "Sobre"            },
  { href: "/portal/planos",          label: "Planos"           },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white font-sans antialiased">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/portal" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center group-hover:bg-red-600 transition-colors">
              <Zap size={16} className="text-white" fill="white" />
            </div>
            <span className="font-black text-lg italic uppercase tracking-tight text-gray-900">AutoZap</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map(l => (
              <Link key={l.href} href={l.href}
                className="text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-widest text-[11px]">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login"
              className="hidden md:block text-[11px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900 transition-colors px-4 py-2">
              Entrar
            </Link>
            <Link href="/portal/planos"
              className="px-5 py-2 bg-gray-900 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors">
              Começar grátis
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-16">{children}</main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-16 mt-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                  <Zap size={16} className="text-white" fill="white" />
                </div>
                <span className="font-black text-xl italic uppercase tracking-tight">AutoZap</span>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed max-w-xs">
                Inteligência artificial para revendas de veículos. Automatize leads, gere vídeos e escale suas vendas.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">Produto</p>
              <ul className="space-y-2">
                {[
                  ["Funcionalidades", "/portal#funcionalidades"],
                  ["Planos e Preços",  "/portal/planos"],
                  ["Sobre nós",        "/portal/sobre"],
                ].map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="text-sm text-gray-400 hover:text-white transition-colors">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">Conta</p>
              <ul className="space-y-2">
                {[
                  ["Fazer login",   "/login"],
                  ["Cadastrar",     "/portal/planos"],
                  ["Suporte",       "https://wa.me/5511999999999"],
                ].map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="text-sm text-gray-400 hover:text-white transition-colors">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">
              © {new Date().getFullYear()} AutoZap. Todos os direitos reservados.
            </p>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">
              Feito com ⚡ para revendas brasileiras
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
