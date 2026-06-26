import type { Metadata } from "next";
import Link from "next/link";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

export const metadata: Metadata = {
  title: "Carros à venda — seminovos e usados verificados",
  description:
    "Encontre seu próximo carro no portal AutoZap: seminovos e usados de revendas verificadas, com fotos, vídeo e atendimento na hora pelo WhatsApp.",
  alternates: { canonical: "/carros" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: `${SITE_URL}/carros`,
    siteName: "AutoZap Carros",
    title: "Carros à venda — seminovos e usados verificados | AutoZap",
    description:
      "Seminovos e usados de revendas verificadas, com fotos, vídeo e atendimento imediato no WhatsApp.",
  },
};

function PortalHeader() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/carros" className="flex items-center gap-2">
          <span className="text-xl font-black uppercase italic tracking-tighter">
            <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
          </span>
          <span className="hidden sm:inline text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 border-l border-gray-200 pl-2">
            Carros
          </span>
        </Link>
        <nav className="flex items-center gap-1.5">
          <Link href="/carros"
            className="px-3.5 py-2 rounded-full text-[11px] font-black uppercase tracking-widest text-gray-900 hover:bg-gray-100 transition">
            Comprar
          </Link>
          <Link href="/login"
            className="px-3.5 py-2 rounded-full text-[11px] font-black uppercase tracking-widest text-white bg-gray-900 hover:bg-red-600 transition">
            Para Lojistas
          </Link>
        </nav>
      </div>
    </header>
  );
}

function PortalFooter() {
  return (
    <footer className="bg-[#161616] text-white mt-20">
      <div className="max-w-7xl mx-auto px-5 py-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <span className="text-2xl font-black uppercase italic tracking-tighter">
              <span className="text-white">AUTO</span><span className="text-red-500">ZAP</span>
              <span className="text-white/40"> Carros</span>
            </span>
            <p className="mt-3 text-sm text-white/50 max-w-sm">
              O portal de seminovos e usados das melhores revendas — com atendimento de verdade,
              na hora, pelo WhatsApp.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-[11px] font-black uppercase tracking-widest text-white/50">
            <Link href="/carros" className="hover:text-white transition">Comprar carro</Link>
            <Link href="/login" className="hover:text-white transition">Anunciar (lojista)</Link>
            <Link href="/" className="hover:text-white transition">Sobre o AutoZap</Link>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-white/10 text-[10px] font-mono uppercase tracking-[0.2em] text-white/30">
          © {new Date().getFullYear()} AutoZap · Veículos de revendas verificadas
        </div>
      </div>
    </footer>
  );
}

export default function CarrosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#f7f7f5] min-h-screen flex flex-col">
      <PortalHeader />
      <div className="flex-1">{children}</div>
      <PortalFooter />
    </div>
  );
}
