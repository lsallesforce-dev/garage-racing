"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import { Megaphone, CheckCircle2, Clock, XCircle } from "lucide-react";
import PublicarMetaButton from "@/components/PublicarMetaButton";

// ─── Ícones de plataforma ─────────────────────────────────────────────────────

function IconFacebook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function IconInstagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function IconOLX({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none">
      <rect width="40" height="40" rx="8" fill="#4B0082" />
      <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="13" fontWeight="900" fontFamily="Arial">OLX</text>
    </svg>
  );
}

function IconWebmotors({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none">
      <rect width="40" height="40" rx="8" fill="#E8261F" />
      <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="7.5" fontWeight="900" fontFamily="Arial">WEB</text>
    </svg>
  );
}

// ─── Badge de campanha ativa ──────────────────────────────────────────────────

function MetaBadge({ veiculoId }: { veiculoId: string }) {
  const [campanhas, setCampanhas] = useState<any[] | null>(null);

  useEffect(() => {
    fetch(`/api/meta/ads?veiculoId=${veiculoId}`)
      .then((r) => r.json())
      .then(({ campanhas }) => setCampanhas(campanhas ?? []))
      .catch(() => setCampanhas([]));
  }, [veiculoId]);

  const ativas = (campanhas ?? []).filter((c) => c.status === "ativo");

  if (campanhas === null) return null;

  if (ativas.length > 0) {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-black uppercase tracking-wider">
        <CheckCircle2 size={9} />
        {ativas.length} ativa{ativas.length > 1 ? "s" : ""}
      </span>
    );
  }

  return null;
}

// ─── Card de veículo ──────────────────────────────────────────────────────────

function VeiculoMarketingCard({ carro, wmConfigurado }: { carro: any; wmConfigurado: boolean }) {
  const [metaOpen, setMetaOpen] = useState(false);
  const fotoUrl = carro.capa_marketing_url ?? carro.fotos?.[0] ?? null;
  const vendido = carro.status_venda === "VENDIDO";

  return (
    <div className={`bg-white rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all ${vendido ? "opacity-60" : ""}`}>
      {/* Foto + info */}
      <div className="flex items-center gap-4 p-4 pb-3">
        <div className="w-20 h-14 flex-shrink-0 bg-gray-100 rounded-xl overflow-hidden relative">
          {fotoUrl ? (
            <img src={fotoUrl} alt={carro.modelo} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Megaphone size={20} />
            </div>
          )}
          {vendido && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="text-[7px] font-black uppercase tracking-widest text-white">Vendido</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-black uppercase italic leading-tight text-gray-900 truncate">
            {carro.marca} {carro.modelo}
          </p>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-0.5 truncate">
            {carro.versao || "—"} • {carro.ano_modelo ?? carro.ano ?? "—"}
          </p>
          <p className="text-[11px] font-black text-slate-900 mt-1">
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(carro.preco_sugerido || 0)}
          </p>
        </div>
      </div>

      {/* Plataformas */}
      <div className="px-4 pb-4 border-t border-gray-50 pt-3">
        <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mb-2.5">Publicar em</p>

        <div className="flex flex-wrap gap-2">
          {/* Meta (Facebook + Instagram) */}
          <div className="flex flex-col items-center gap-1">
            <button
              disabled={vendido || !fotoUrl}
              onClick={() => setMetaOpen(true)}
              title={!fotoUrl ? "Adicione uma foto ao veículo primeiro" : "Publicar no Facebook/Instagram"}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-blue-100"
            >
              <IconFacebook className="w-3.5 h-3.5 text-blue-600" />
              <IconInstagram className="w-3.5 h-3.5 text-pink-500" />
              <span className="text-[9px] font-black uppercase tracking-wider text-blue-700">Meta Ads</span>
            </button>
            <MetaBadge veiculoId={carro.id} />
          </div>

          {/* OLX */}
          <div className="flex flex-col items-center gap-1">
            <button
              disabled
              title="Em breve — aguardando homologação OLX"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-50 opacity-40 cursor-not-allowed border border-purple-100"
            >
              <IconOLX className="w-4 h-4" />
              <span className="text-[9px] font-black uppercase tracking-wider text-purple-700">OLX</span>
            </button>
            <span className="text-[8px] text-gray-300 font-bold uppercase tracking-wider">Em breve</span>
          </div>

          {/* Webmotors */}
          <div className="flex flex-col items-center gap-1">
            {wmConfigurado ? (
              <>
                <div
                  title="Leads do Webmotors chegam automaticamente via webhook"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 border border-red-100"
                >
                  <IconWebmotors className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-wider text-red-700">Webmotors</span>
                </div>
                <span className="flex items-center gap-0.5 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-black uppercase tracking-wider">
                  <CheckCircle2 size={9} /> Ativo
                </span>
              </>
            ) : (
              <>
                <a
                  href="/configuracoes"
                  title="Configure as credenciais Webmotors em Configurações"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 border border-red-100 transition-colors"
                >
                  <IconWebmotors className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-wider text-red-700">Webmotors</span>
                </a>
                <span className="text-[8px] text-gray-300 font-bold uppercase tracking-wider">Configurar</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal Meta Ads (montado fora do card para evitar overflow) */}
      {metaOpen && (
        <PublicarMetaButton
          veiculoId={carro.id}
          marca={carro.marca ?? ""}
          modelo={carro.modelo ?? ""}
          ano={carro.ano_modelo ?? carro.ano ?? ""}
          fotoUrl={fotoUrl}
          defaultOpen
          onClose={() => setMetaOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const { effectiveUserId } = useUserRole();
  const [carros, setCarros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "disponiveis">("disponiveis");
  const [wmConfigurado, setWmConfigurado] = useState(false);

  useEffect(() => {
    if (!effectiveUserId) return;

    // Carrega veículos e verifica credenciais Webmotors em paralelo
    Promise.all([
      supabase
        .from("veiculos")
        .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, capa_marketing_url, fotos, status_venda")
        .eq("user_id", effectiveUserId)
        .order("status_venda", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("config_garage")
        .select("webmotors_usuario")
        .eq("user_id", effectiveUserId)
        .maybeSingle(),
    ]).then(([veiculos, config]) => {
      setCarros(veiculos.data ?? []);
      setWmConfigurado(!!config.data?.webmotors_usuario);
      setLoading(false);
    });
  }, [effectiveUserId]);

  const carrosFiltrados = filtro === "disponiveis"
    ? carros.filter((c) => c.status_venda !== "VENDIDO")
    : carros;

  return (
    <div className="p-4 md:p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end mb-8 md:mb-10">
          <div>
            <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-300 leading-none mb-2 tracking-tighter">
              Marketing
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
              Publique seus carros nos portais e redes sociais.
            </p>
          </div>

          {/* Filtro */}
          <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm self-start sm:self-auto">
            {(["disponiveis", "todos"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  filtro === f ? "bg-gray-900 text-white shadow" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                {f === "disponiveis" ? "Disponíveis" : "Todos"}
              </button>
            ))}
          </div>
        </div>

        {/* Grid de veículos */}
        {loading ? (
          <div className="py-32 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : carrosFiltrados.length === 0 ? (
          <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
            Nenhum veículo disponível no estoque.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {carrosFiltrados.map((carro) => (
              <VeiculoMarketingCard key={carro.id} carro={carro} wmConfigurado={wmConfigurado} />
            ))}
          </div>
        )}

        {/* Plataformas em breve */}
        <div className="mt-10 bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-4">Integrações planejadas</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { nome: "OLX", cor: "bg-purple-50 border-purple-100", corText: "text-purple-600", status: "Aguardando homologação", icon: <IconOLX className="w-6 h-6" /> },
              { nome: "Webmotors", cor: "bg-red-50 border-red-100", corText: "text-red-600", status: wmConfigurado ? "Webhook ativo" : "Configure em Configurações", icon: <IconWebmotors className="w-6 h-6" /> },
              { nome: "iCarros", cor: "bg-orange-50 border-orange-100", corText: "text-orange-600", status: "Planejado", icon: <span className="text-[10px] font-black text-orange-600">iCarros</span> },
              { nome: "Mercado Livre", cor: "bg-yellow-50 border-yellow-100", corText: "text-yellow-700", status: "Planejado", icon: <span className="text-[10px] font-black text-yellow-700">ML</span> },
            ].map((p) => (
              <div key={p.nome} className={`flex items-center gap-3 p-3 rounded-2xl border ${p.cor}`}>
                <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">{p.icon}</div>
                <div>
                  <p className={`text-[10px] font-black uppercase ${p.corText}`}>{p.nome}</p>
                  <p className="text-[9px] text-gray-400">{p.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
