"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import { Megaphone, LayoutList, Layers, Settings, CalendarDays } from "lucide-react";
import PublicarMetaButton from "@/components/PublicarMetaButton";
import PublicarPortaisModal, { publicadoNoPortal, type Portal } from "@/components/PublicarPortaisModal";
import KitsGaleria from "@/components/KitsGaleria";
import CarrosselEstoqueModal from "@/components/CarrosselEstoqueModal";
import { midiaDoVeiculo, melhorFormato, miniatura, COLUNAS_MIDIA } from "@/lib/veiculo-midia";

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

// ─── Botão de canal (com bolinha verde quando ativo) ─────────────────────────

function PortalButton({ label, icon, active, disabled, title, onClick }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
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
  );
}

// ─── Card de veículo (layout horizontal) ─────────────────────────────────────

interface Conexoes { olx: boolean; webmotors: boolean; ml: boolean }

function VeiculoMarketingCard({ carro, conexoes, metaAtivas }: { carro: any; conexoes: Conexoes; metaAtivas: number }) {
  const [metaOpen, setMetaOpen]         = useState(false);
  const [portalAberto, setPortalAberto] = useState<Portal | null>(null);
  const [carroLocal, setCarroLocal]     = useState(carro);
  // Mesma fonte de imagem do anúncio e da galeria de Kits: arte do kit, senão foto.
  const midia   = midiaDoVeiculo(carroLocal);
  const fotoUrl = midia.imagemPadrao;
  const vendido = carroLocal.status_venda === "VENDIDO";

  const portais: { id: Portal; label: string; icon: React.ReactNode; conectado: boolean }[] = [
    { id: "olx",       label: "OLX",       icon: <IconOLX className="w-5 h-5" />,       conectado: conexoes.olx },
    { id: "webmotors", label: "Webmotors", icon: <IconWebmotors className="w-5 h-5" />, conectado: conexoes.webmotors },
    { id: "ml",        label: "ML",        icon: <IconML className="w-5 h-5" />,        conectado: conexoes.ml },
  ];

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all ${vendido ? "opacity-50" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4">

        {/* ── Esquerda: foto + info ── */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-28 h-20 flex-shrink-0 bg-gray-100 rounded-xl overflow-hidden relative">
            {fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={miniatura(fotoUrl, 112, 80)!} alt={carro.modelo} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-300">
                <Megaphone size={20} />
                <span className="text-[8px] font-black uppercase tracking-widest">Sem foto</span>
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

        {/* ── Direita: canais ── */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap sm:flex-nowrap">
          <PortalButton
            label="Meta Ads"
            icon={
              <span className="flex items-center gap-0.5">
                <IconFacebook className="w-4 h-4 text-blue-600" />
                <IconInstagram className="w-4 h-4 text-pink-500" />
              </span>
            }
            active={metaAtivas > 0}
            disabled={vendido || !fotoUrl}
            title={
              !fotoUrl && !vendido ? "Adicione uma foto ao veículo pra anunciar"
                : metaAtivas > 0 ? `${metaAtivas} anúncio(s) ativo(s)`
                : "Anunciar no Meta Ads (pago)"
            }
            onClick={() => setMetaOpen(true)}
          />

          {portais.map((p) => (
            <PortalButton
              key={p.id}
              label={p.label}
              icon={p.icon}
              active={p.conectado && publicadoNoPortal(p.id, carroLocal)}
              disabled={vendido}
              title={p.conectado ? undefined : "Não conectado — clique pra ver como conectar"}
              onClick={() => setPortalAberto(p.id)}
            />
          ))}
        </div>
      </div>

      {metaOpen && (
        <PublicarMetaButton
          veiculoId={carroLocal.id}
          marca={carroLocal.marca ?? ""}
          modelo={carroLocal.modelo ?? ""}
          ano={carroLocal.ano_modelo ?? carroLocal.ano ?? ""}
          fotoUrl={fotoUrl}
          formatoInicial={melhorFormato(midia)}
          defaultOpen
          onClose={() => setMetaOpen(false)}
        />
      )}

      {portalAberto && (
        <PublicarPortaisModal
          portal={portalAberto}
          veiculo={carroLocal}
          conectado={portais.find((p) => p.id === portalAberto)!.conectado}
          onClose={() => setPortalAberto(null)}
          onStatusChange={(campo, valor) =>
            setCarroLocal((prev: any) => ({ ...prev, [campo]: valor }))
          }
        />
      )}
    </div>
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
  const [carrosselOpen, setCarrosselOpen] = useState(false);
  const [conexoes, setConexoes] = useState<Conexoes>({ olx: false, webmotors: false, ml: false });
  const [metaAtivas, setMetaAtivas] = useState<Record<string, number>>({});

  const fetchConfig = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("config_garage")
      .select("webmotors_usuario, olx_access_token, ml_access_token")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = data?.[0];
    setConexoes({ olx: !!row?.olx_access_token, webmotors: !!row?.webmotors_usuario, ml: !!row?.ml_access_token });
  }, []);

  useEffect(() => {
    if (!effectiveUserId) return;

    Promise.all([
      supabase
        .from("veiculos")
        .select(`id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, status_venda, status_olx, status_webmotors, olx_ad_id, status_ml, ml_item_id, ${COLUNAS_MIDIA}`)
        .eq("user_id", effectiveUserId)
        .order("status_venda", { ascending: true })
        .order("created_at", { ascending: false }),
      fetchConfig(effectiveUserId),
    ]).then(([veiculos]) => {
      setCarros(veiculos.data ?? []);
      setLoading(false);
    });

    // Uma chamada pro tenant inteiro (era uma por carro).
    fetch("/api/meta/ads")
      .then((r) => r.json())
      .then((d) => setMetaAtivas(d.ativasPorVeiculo ?? {}))
      .catch(() => {});
  }, [effectiveUserId, fetchConfig]);

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
      setConexoes((c) => ({ ...c, olx: true }));
    }
  }, [searchParams]);

  const carrosFiltrados = filtro === "disponiveis"
    ? carros.filter((c) => c.status_venda !== "VENDIDO")
    : carros;

  const conexoesLista = [
    { nome: "OLX", conectado: conexoes.olx, icon: <IconOLX className="w-6 h-6" /> },
    { nome: "Webmotors", conectado: conexoes.webmotors, icon: <IconWebmotors className="w-6 h-6" /> },
    { nome: "Mercado Livre", conectado: conexoes.ml, icon: <IconML className="w-6 h-6" /> },
  ];

  return (
    <div className="p-4 md:p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end mb-8">
          <div>
            <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-300 leading-none mb-2 tracking-tighter">
              Marketing
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
              Postar é grátis (seu Face e Insta) · Anunciar é pago (Meta Ads e portais)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setCarrosselOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-700 transition-all"
            >
              <Layers size={14} /> Anunciar o estoque
            </button>
            <Link
              href="/marketing/anuncios"
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-all"
            >
              <LayoutList size={14} /> Anúncios ativos
            </Link>
            <Link
              href="/marketing/planejamento"
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-800 rounded-2xl text-[10px] font-black uppercase tracking-wider hover:border-indigo-300 hover:text-indigo-600 transition-all"
            >
              <CalendarDays size={14} /> Planejamento
            </Link>
          </div>
        </div>

        {/* Abas: Portais | Kits de Postagem  +  filtro (só Portais) */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm w-fit">
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

          {aba === "portais" && (
            <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm">
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

        {aba === "kits" && <KitsGaleria />}

        {/* Lista de veículos */}
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
              <VeiculoMarketingCard key={carro.id} carro={carro} conexoes={conexoes} metaAtivas={metaAtivas[carro.id] ?? 0} />
            ))}
          </div>
        ))}

        {carrosselOpen && (
          <CarrosselEstoqueModal veiculos={carros} onClose={() => setCarrosselOpen(false)} />
        )}

        {/* Conexões dos portais — estado real, com atalho pra conectar */}
        {aba === "portais" && (
          <div className="mt-10 bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Conexões dos portais</p>
              <Link href="/configuracoes?tab=portais" className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700">
                <Settings size={11} /> Configurar
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {conexoesLista.map((p) => (
                <Link
                  key={p.nome}
                  href="/configuracoes?tab=portais"
                  className={`flex items-center gap-3 p-3 rounded-2xl border transition-all hover:shadow-sm ${p.conectado ? "border-green-100 bg-green-50/50" : "border-gray-100 bg-gray-50"}`}
                >
                  <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">{p.icon}</div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-700">{p.nome}</p>
                    <p className={`text-[9px] font-bold ${p.conectado ? "text-green-600" : "text-gray-400"}`}>
                      {p.conectado ? "● Conectado" : "Não conectado — conectar"}
                    </p>
                  </div>
                </Link>
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
