import type { Metadata } from "next";
import Link from "next/link";

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
  { href: "/#funcionalidades", label: "Funcionalidades" },
  { href: "/sobre",           label: "Sobre"            },
  { href: "/planos",          label: "Planos"           },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white font-sans antialiased">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <svg width="90" height="42" viewBox="0 0 240 110" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="240" height="48" fill="#E0130F"/>
              <polygon points="0,42 240,48 240,53 0,47" fill="#0D0D0F" opacity="0.25"/>
              <text x="8" y="40" fontFamily="'Barlow Condensed','Arial Narrow',sans-serif" fontWeight="700" fontSize="34" fill="#FAFAF8" letterSpacing="28">AUTO</text>
              <text x="-2" y="108" fontFamily="'Barlow Condensed','Arial Narrow',sans-serif" fontWeight="900" fontSize="72" fill="#0D0D0F" letterSpacing="-3">ZAP</text>
              <circle cx="106" cy="91" r="5" fill="#E0130F"/>
            </svg>
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
            <a href="/login"
              className="text-[11px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900 transition-colors px-4 py-2">
              Entrar
            </a>
            <Link href="/planos"
              className="hidden md:block px-5 py-2 bg-gray-900 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors">
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
              <div className="mb-4">
                <svg width="90" height="42" viewBox="0 0 240 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0" y="0" width="240" height="48" fill="#E0130F"/>
                  <polygon points="0,42 240,48 240,53 0,47" fill="#0D0D0F" opacity="0.35"/>
                  <text x="8" y="40" fontFamily="'Barlow Condensed','Arial Narrow',sans-serif" fontWeight="700" fontSize="34" fill="#FAFAF8" letterSpacing="28">AUTO</text>
                  <text x="-2" y="108" fontFamily="'Barlow Condensed','Arial Narrow',sans-serif" fontWeight="900" fontSize="72" fill="#FAFAF8" letterSpacing="-3">ZAP</text>
                  <circle cx="106" cy="91" r="5" fill="#E0130F"/>
                </svg>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed max-w-xs">
                Inteligência artificial para revendas de veículos. Automatize leads, gere vídeos e escale suas vendas.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">Produto</p>
              <ul className="space-y-2">
                {[
                  ["Funcionalidades", "/#funcionalidades"],
                  ["Planos e Preços",  "/planos"],
                  ["Sobre nós",        "/sobre"],
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
                  ["Cadastrar",     "/planos"],
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
              © {new Date().getFullYear()} AutoZap · LS Tecnologias. Todos os direitos reservados.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/privacidade" className="text-[10px] text-gray-600 hover:text-gray-400 uppercase tracking-widest font-bold transition-colors">
                Privacidade
              </Link>
              <Link href="/termos" className="text-[10px] text-gray-600 hover:text-gray-400 uppercase tracking-widest font-bold transition-colors">
                Termos
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
