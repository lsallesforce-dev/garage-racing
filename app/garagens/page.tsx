import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Car, ArrowRight, Search } from "lucide-react";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "AutoZap — Garagens Parceiras",
  description: "Encontre veículos verificados com IA nas melhores garagens do Brasil. Compre com segurança.",
  openGraph: {
    title: "AutoZap — Encontre sua próxima máquina",
    description: "Centenas de veículos verificados com IA. Estoque real, preço justo.",
    type: "website",
  },
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getGaragens() {
  const { data: garagens } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, endereco, logo_url, vitrine_slug")
    .not("vitrine_slug", "is", null)
    .not("nome_empresa", "is", null);

  if (!garagens?.length) return [];

  const resultados = await Promise.all(
    garagens.map(async (g) => {
      const { count } = await supabaseAdmin
        .from("veiculos")
        .select("*", { count: "exact", head: true })
        .eq("user_id", g.user_id)
        .eq("status_venda", "DISPONIVEL");

      if (!count || count === 0) return null;

      const cidade = g.endereco
        ? (g.endereco.split("—")[1] ?? g.endereco.split(",").slice(-2).join(","))?.trim()
        : null;

      return { slug: g.vitrine_slug!, nome: g.nome_empresa!, logo_url: g.logo_url ?? null, cidade, veiculos: count };
    })
  );

  return resultados.filter(Boolean).sort((a, b) => b!.veiculos - a!.veiculos) as {
    slug: string; nome: string; logo_url: string | null; cidade: string | null; veiculos: number;
  }[];
}

export default async function GaragensPage() {
  const garagens = await getGaragens();
  const totalVeiculos = garagens.reduce((acc, g) => acc + g.veiculos, 0);

  return (
    <div className="min-h-screen bg-[#efefed] text-gray-900 font-sans">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-black uppercase italic tracking-tighter">
            <span className="text-gray-900">AUTO</span>
            <span className="text-red-600">ZAP</span>
          </span>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Marketplace de Garagens
          </span>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="bg-gray-900 text-white py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-red-500 mb-4">
            Verificado com Inteligência Artificial
          </p>
          <h1 className="text-5xl md:text-7xl font-black uppercase italic tracking-tighter leading-none mb-6">
            Encontre sua<br />
            <span className="text-red-500">próxima máquina</span>
          </h1>
          <p className="text-gray-400 text-sm max-w-xl mx-auto mb-10">
            {garagens.length} garagens parceiras · {totalVeiculos.toLocaleString("pt-BR")} veículos disponíveis
          </p>

          {/* Search hint */}
          <div className="inline-flex items-center gap-3 bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-sm text-gray-300 max-w-md w-full">
            <Search size={16} className="text-gray-500 shrink-0" />
            <span className="text-gray-500">Procure pelo nome ou cidade da garagem abaixo...</span>
          </div>
        </div>
      </section>

      {/* ── Grid de Garagens ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-gray-900">
              Garagens parceiras
            </h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">
              {garagens.length} lojas · {totalVeiculos} veículos no ar
            </p>
          </div>
        </div>

        {garagens.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <Car size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-black uppercase tracking-widest text-[11px]">Nenhuma garagem disponível no momento</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {garagens.map((g) => (
              <Link
                key={g.slug}
                href={`/vitrine/${g.slug}`}
                className="group bg-white rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 p-8 flex flex-col"
              >
                {/* Logo / Iniciais */}
                <div className="mb-6 flex items-center justify-between">
                  <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {g.logo_url ? (
                      <img src={g.logo_url} alt={g.nome} className="w-full h-full object-contain p-2" />
                    ) : (
                      <span className="text-xl font-black text-gray-300 uppercase">
                        {g.nome.substring(0, 2)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-100">
                    {g.veiculos} carros
                  </span>
                </div>

                {/* Info */}
                <h3 className="text-lg font-black uppercase italic tracking-tight text-gray-900 leading-tight mb-2">
                  {g.nome}
                </h3>

                {g.cidade && (
                  <div className="flex items-center gap-1.5 text-gray-400 mb-6">
                    <MapPin size={11} />
                    <span className="text-[11px] font-bold uppercase tracking-wide">{g.cidade}</span>
                  </div>
                )}

                {/* CTA */}
                <div className="mt-auto flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-gray-900 group-hover:text-red-600 transition-colors">
                  Ver estoque
                  <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 py-10 px-6 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          © {new Date().getFullYear()} AutoZap · Inteligência Automotiva
        </p>
        <p className="text-[9px] text-gray-300 mt-1 uppercase tracking-widest">
          Plataforma de gestão com IA para concessionárias e pátios
        </p>
      </footer>

    </div>
  );
}
