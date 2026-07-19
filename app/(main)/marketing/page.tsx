"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import { Megaphone, LayoutList } from "lucide-react";
import PublicarMetaButton from "@/components/PublicarMetaButton";
import PublicarPortaisModal from "@/components/PublicarPortaisModal";
import KitsGaleria from "@/components/KitsGaleria";

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

function IconML({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none">
      <rect width="40" height="40" rx="8" fill="#FFE600" />
      <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="#333" fontSize="11" fontWeight="900" fontFamily="Arial">ML</text>
    </svg>
  );
}

// ─── Botão de portal genérico (com bolinha verde quando ativo) ───────────────

function PortalButton({ label, icon, active, disabled, hint, onClick }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const [showHint, setShowHint] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    if (!active && hint) { setShowHint(v => !v); return; }
    onClick?.();
  };

  return (
    <>
      {showHint && <div className="fixed inset-0 z-40" onClick={() => setShowHint(false)} />}
      <div className="relative">
        <button
          onClick={handleClick}
          className={`relative flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black uppercase tracking-wider transition-all ${
            disabled
              ? "bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed"
              : active
                ? "bg-white border-gray-200 text-gray-800 shadow-sm hover:shadow-md"
                : "bg-gray-50 border-gray-100 text-gray-400 hover:bg-gray-100 cursor-pointer"
          }`}
        >
          {icon}
          {label}
          {active && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow" />
          )}
        </button>

        {showHint && hint && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 bg-gray-900 text-white rounded-xl p-3 shadow-xl z-50 text-center">
            <p className="text-[10px] font-bold leading-snug">{hint}</p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
          </div>
        )}
      </div>
    </>
  );
}

// ─── Card de veículo (layout horizontal) ─────────────────────────────────────

function VeiculoMarketingCard({ carro, wmConfigurado, olxConectado, mlConectado }: { carro: any; wmConfigurado: boolean; olxConectado: boolean; mlConectado: boolean }) {
  const [metaOpen, setMetaOpen]       = useState(false);
  const [portaisOpen, setPortaisOpen] = useState(false);
  const [carroLocal, setCarroLocal]   = useState(carro);
  const fotoUrl = carroLocal.capa_marketing_url ?? carroLocal.fotos?.[0] ?? null;
  const vendido = carroLocal.status_venda === "VENDIDO";

  const olxPublicado = carroLocal.status_olx === "publicado" || carroLocal.status_olx === "pendente";
  const wmPublicado  = carroLocal.status_webmotors === "publicado";
  const mlPublicado  = carroLocal.status_ml === "publicado";

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all ${vendido ? "opacity-50" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4">

        {/* ── Esquerda: foto + info ── */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-28 h-20 flex-shrink-0 bg-gray-100 rounded-xl overflow-hidden relative">
            {fotoUrl ? (
              <img src={fotoUrl} alt={carro.modelo} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300">
                <Megaphone size={22} />
              </div>
            )}
            {vendido && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-[8px] font-black uppercase tracking-widest text-white">Vendido</span>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-base font-black uppercase italic leading-tight text-gray-900 truncate">
              {carro.marca} {carro.modelo}
            </p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-0.5 truncate">
              {carro.versao || "—"} • {carro.ano_modelo ?? carro.ano ?? "—"}
            </p>
            <p className="text-sm font-black text-slate-900 mt-1.5">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(carro.preco_sugerido || 0)}
            </p>
          </div>
        </div>

        {/* ── Direita: botões de portal ── */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap sm:flex-nowrap">
          {/* Meta Ads */}
          <MetaPortalButton
            veiculoId={carro.id}
            disabled={vendido || !fotoUrl}
            noPhoto={!fotoUrl && !vendido}
            onClick={() => setMetaOpen(true)}
          />

          {/* OLX */}
          <PortalButton
            label="OLX"
            icon={<IconOLX className="w-5 h-5" />}
            active={olxConectado && olxPublicado}
            disabled={vendido}
            hint={!olxConectado ? "Conecte sua conta OLX em Configurações." : undefined}
            onClick={olxConectado ? () => setPortaisOpen(true) : undefined}
          />

          {/* Webmotors */}
          <PortalButton
            label="Webmotors"
            icon={<IconWebmotors className="w-5 h-5" />}
            active={wmConfigurado && wmPublicado}
            disabled={vendido}
            hint={!wmConfigurado ? "Configure Webmotors em Configurações." : undefined}
            onClick={wmConfigurado ? () => setPortaisOpen(true) : undefined}
          />

          {/* Mercado Livre */}
          <PortalButton
            label="ML"
            icon={<IconML className="w-5 h-5" />}
            active={mlConectado && mlPublicado}
            disabled={vendido}
            hint={!mlConectado ? "Conecte sua conta ML em Configurações." : undefined}
            onClick={mlConectado ? () => setPortaisOpen(true) : undefined}
          />
        </div>
      </div>

      {/* Modal Meta Ads */}
      {metaOpen && (
        <PublicarMetaButton
          veiculoId={carroLocal.id}
          marca={carroLocal.marca ?? ""}
          modelo={carroLocal.modelo ?? ""}
          ano={carroLocal.ano_modelo ?? carroLocal.ano ?? ""}
          fotoUrl={fotoUrl}
          defaultOpen
          onClose={() => setMetaOpen(false)}
        />
      )}

      {/* Modal Portais (OLX + Webmotors + ML) */}
      {portaisOpen && (
        <PublicarPortaisModal
          veiculo={carroLocal}
          olxConectado={olxConectado}
          wmConfigurado={wmConfigurado}
          mlConectado={mlConectado}
          isOpen={portaisOpen}
          onClose={() => setPortaisOpen(false)}
          onStatusChange={(campo, valor) =>
            setCarroLocal((prev: any) => ({ ...prev, [campo]: valor }))
          }
        />
      )}
    </div>
  );
}

// ─── Botão Meta com estado de campanhas ativas ───────────────────────────────

function MetaPortalButton({ veiculoId, disabled, noPhoto, onClick }: {
  veiculoId: string; disabled?: boolean; noPhoto?: boolean; onClick: () => void;
}) {
  const [ativas, setAtivas] = useState(0);

  useEffect(() => {
    fetch(`/api/meta/ads?veiculoId=${veiculoId}`)
      .then(r => r.json())
      .then(({ campanhas }) => {
        setAtivas((campanhas ?? []).filter((c: any) => c.status === "ativo").length);
      })
      .catch(() => {});
  }, [veiculoId]);

  return (
    <PortalButton
      label="Meta Ads"
      icon={
        <span className="flex items-center gap-0.5">
          <IconFacebook className="w-4 h-4 text-blue-600" />
          <IconInstagram className="w-4 h-4 text-pink-500" />
        </span>
      }
      active={ativas > 0}
      disabled={disabled}
      hint={noPhoto ? "Adicione uma foto ao veículo primeiro." : undefined}
      onClick={onClick}
    />
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

function MarketingPageInner() {
  const { effectiveUserId } = useUserRole();
  const searchParams = useSearchParams();
  const [carros, setCarros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "disponiveis">("disponiveis");
  const [aba, setAba] = useState<"portais" | "kits">(
    searchParams.get("tab") === "kits" ? "kits" : "portais"
  );
  const [wmConfigurado, setWmConfigurado] = useState(false);
  const [olxConectado, setOlxConectado]   = useState(false);
  const [mlConectado, setMlConectado]     = useState(false);

  const fetchConfig = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("config_garage")
      .select("webmotors_usuario, olx_access_token, ml_access_token")
      .eq("user_id", userId)
      .maybeSingle();
    setWmConfigurado(!!data?.webmotors_usuario);
    setOlxConectado(!!data?.olx_access_token);
    setMlConectado(!!data?.ml_access_token);
  }, []);

  useEffect(() => {
    if (!effectiveUserId) return;

    Promise.all([
      supabase
        .from("veiculos")
        .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, capa_marketing_url, fotos, status_venda, status_olx, status_webmotors, olx_ad_id, status_ml, ml_item_id")
        .eq("user_id", effectiveUserId)
        .order("status_venda", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("config_garage")
        .select("webmotors_usuario, olx_access_token, ml_access_token")
        .eq("user_id", effectiveUserId)
        .maybeSingle(),
    ]).then(([veiculos, config]) => {
      setCarros(veiculos.data ?? []);
      setWmConfigurado(!!config.data?.webmotors_usuario);
      setOlxConectado(!!config.data?.olx_access_token);
      setMlConectado(!!config.data?.ml_access_token);
      setLoading(false);
    });
  }, [effectiveUserId]);

  // Re-fetch config when tab regains focus (after OLX OAuth completes in another tab)
  useEffect(() => {
    if (!effectiveUserId) return;
    const onFocus = () => fetchConfig(effectiveUserId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [effectiveUserId, fetchConfig]);

  // Also handle redirect back from OLX callback with ?olx_conectado=1
  useEffect(() => {
    if (searchParams.get("olx_conectado") === "1") {
      setOlxConectado(true);
    }
  }, [searchParams]);

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

          <Link
            href="/marketing/anuncios"
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-all self-start sm:self-auto"
          >
            <LayoutList size={14} /> Ver Anúncios Ativos
          </Link>

          {/* Filtro (só na aba Portais) */}
          {aba === "portais" && (
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
          )}
        </div>

        {/* Abas: Portais | Kits de Postagem */}
        <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm self-start w-fit mb-8">
          {([["portais", "Portais"], ["kits", "Kits de Postagem"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                aba === id ? "bg-gray-900 text-white shadow" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {aba === "kits" && <KitsGaleria />}

        {/* Grid de veículos */}
        {aba === "portais" && (loading ? (
          <div className="py-32 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : carrosFiltrados.length === 0 ? (
          <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
            Nenhum veículo disponível no estoque.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {carrosFiltrados.map((carro) => (
              <VeiculoMarketingCard key={carro.id} carro={carro} wmConfigurado={wmConfigurado} olxConectado={olxConectado} mlConectado={mlConectado} />
            ))}
          </div>
        ))}

        {/* Plataformas em breve */}
        {aba === "portais" && (
          <div className="mt-10 bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-4">Integrações planejadas</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { nome: "OLX", cor: "bg-purple-50 border-purple-100", corText: "text-purple-600", status: olxConectado ? "Conectado" : "Clique para conectar", icon: <IconOLX className="w-6 h-6" /> },
                { nome: "Webmotors", cor: "bg-red-50 border-red-100", corText: "text-red-600", status: wmConfigurado ? "Webhook ativo" : "Configure em Configurações", icon: <IconWebmotors className="w-6 h-6" /> },
                { nome: "iCarros", cor: "bg-orange-50 border-orange-100", corText: "text-orange-600", status: "Planejado", icon: <span className="text-[10px] font-black text-orange-600">iCarros</span> },
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
        )}

      </div>
    </div>
  );
}

export default function MarketingPage() {
  return (
    <Suspense fallback={null}>
      <MarketingPageInner />
    </Suspense>
  );
}
