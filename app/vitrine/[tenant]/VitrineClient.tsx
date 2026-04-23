"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Zap, MessageCircle, Play, Award,
  X, ChevronDown, SlidersHorizontal, ArrowRight,
} from "lucide-react";

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ─── Selos do veículo ─────────────────────────────────────────────────────────

const SELOS: { key: string; label: string; color: string }[] = [
  { key: "segundo_dono_false",  label: "Único Dono",         color: "bg-blue-600 text-white" },
  { key: "vistoriado",          label: "Vistoriado",         color: "bg-green-600 text-white" },
  { key: "vistoria_cautelar",   label: "Vistoria Cautelar",  color: "bg-teal-600 text-white" },
  { key: "abaixo_fipe",         label: "Abaixo FIPE",        color: "bg-orange-500 text-white" },
  { key: "de_repasse",          label: "De Repasse",         color: "bg-purple-600 text-white" },
];

function selosAtivos(carro: any) {
  return SELOS.filter(({ key }) => {
    if (key === "segundo_dono_false") return carro.segundo_dono === false;
    return carro[key] === true;
  });
}

// ─── Modal de Financiamento ───────────────────────────────────────────────────

function ModalFinanciamento({ carro, whatsapp, nomeEmpresa, onClose }: { carro: any; whatsapp: string; nomeEmpresa: string; onClose: () => void }) {
  const preco = carro.preco_sugerido ?? 0;
  const [entrada, setEntrada] = useState("");
  const [parcelas, setParcelas] = useState("48");
  const [nome, setNome] = useState("");

  const entradaNum = parseFloat(entrada.replace(/\./g, "").replace(",", ".")) || 0;

  const msgWpp = encodeURIComponent(
    `Olá! Vi o *${carro.marca} ${carro.modelo}${carro.ano_modelo ? " " + carro.ano_modelo : ""}* na vitrine da ${nomeEmpresa} e gostaria de uma simulação de financiamento real.\n\n` +
    `💰 Valor do veículo: ${fmt(preco)}\n` +
    (entradaNum > 0 ? `💵 Entrada: ${fmt(entradaNum)}\n` : "") +
    `📅 Prazo desejado: ${parcelas}x\n` +
    (nome ? `👤 Nome: ${nome}\n` : "") +
    `\nPode me ajudar com as melhores condições?`
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Simulação de Financiamento</p>
            <h3 className="text-xl font-black uppercase italic tracking-tight text-gray-900">{carro.marca} {carro.modelo}</h3>
            <p className="text-sm font-black tracking-tighter text-red-600 mt-1">{fmt(preco)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Seu nome</label>
            <input type="text" placeholder="Ex: João Silva" value={nome} onChange={(e) => setNome(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Valor de entrada (R$)</label>
            <input type="number" placeholder="Ex: 15000" value={entrada} onChange={(e) => setEntrada(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Prazo desejado</label>
            <div className="relative">
              <select value={parcelas} onChange={(e) => setParcelas(e.target.value)}
                className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-red-500 pr-10">
                {[12, 24, 36, 48, 60, 72].map((n) => <option key={n} value={n}>{n}x</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-6">
          <p className="text-[9px] text-gray-400 leading-relaxed">
            Um consultor vai te enviar a simulação real com as condições do banco, taxa de juros atualizada e melhores opções de prazo.
          </p>
        </div>

        <a href={`https://wa.me/${whatsapp}?text=${msgWpp}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-400 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all hover:scale-[1.02] active:scale-[0.98]">
          <MessageCircle size={16} /> Solicitar simulação real
        </a>
      </div>
    </div>
  );
}

// ─── Vitrine Client ───────────────────────────────────────────────────────────

interface Props {
  tenant: string;
  nomeEmpresa: string;
  whatsapp: string;
  estoque: any[];
  logoUrl?: string | null;
}

export default function VitrineClient({ tenant, nomeEmpresa, whatsapp, estoque, logoUrl }: Props) {
  const [modalCarro, setModalCarro] = useState<any | null>(null);
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroModelo, setFiltroModelo] = useState("");
  const [filtroAno, setFiltroAno] = useState("");
  const [filtroPreco, setFiltroPreco] = useState("");

  const marcas = useMemo(() => [...new Set(estoque.map((c) => c.marca).filter(Boolean))].sort(), [estoque]);
  const modelos = useMemo(
    () => [...new Set(estoque.filter((c) => !filtroMarca || c.marca === filtroMarca).map((c) => c.modelo).filter(Boolean))].sort(),
    [estoque, filtroMarca]
  );
  const anos = useMemo(
    () => [...new Set(estoque.map((c) => c.ano_modelo).filter(Boolean))].sort((a, b) => b - a),
    [estoque]
  );

  const estoqueFiltrado = useMemo(
    () => estoque.filter((c) => {
      if (filtroMarca && c.marca !== filtroMarca) return false;
      if (filtroModelo && c.modelo !== filtroModelo) return false;
      if (filtroAno && String(c.ano_modelo) !== filtroAno) return false;
      if (filtroPreco && (c.preco_sugerido ?? 0) > parseInt(filtroPreco)) return false;
      return true;
    }),
    [estoque, filtroMarca, filtroModelo, filtroAno, filtroPreco]
  );

  const filtrosAtivos = filtroMarca || filtroModelo || filtroAno || filtroPreco;
  function limparFiltros() { setFiltroMarca(""); setFiltroModelo(""); setFiltroAno(""); setFiltroPreco(""); }

  const selectClass = "appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 pr-8 w-full cursor-pointer";

  return (
    <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          {logoUrl ? (
            <img src={logoUrl} alt={nomeEmpresa} className="h-14 w-auto object-contain" />
          ) : (
            <span className="text-xl font-black uppercase italic tracking-tighter text-gray-900">{nomeEmpresa}</span>
          )}
          <a
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Olá! Preciso de ajuda para escolher um veículo.")}`}
            target="_blank" rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-600 hover:text-green-500 transition-colors"
          >
            <MessageCircle size={14} /> Falar com consultor
          </a>
        </div>
      </header>

      {/* ── Hero + Filtro ── */}
      <div className="bg-white border-b border-gray-100 pt-12 pb-8 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
              Encontre seu próximo <span className="text-red-600">veículo</span>
            </h1>
            <p className="text-gray-400 text-sm max-w-md mx-auto">
              Cada veículo analisado e verificado. Vídeo completo, pontos fortes e atendimento imediato.
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal size={13} className="text-gray-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Filtrar estoque</span>
              {filtrosAtivos && (
                <button onClick={limparFiltros} className="ml-auto text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 flex items-center gap-1">
                  <X size={11} /> Limpar
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="relative">
                <select value={filtroMarca} onChange={(e) => { setFiltroMarca(e.target.value); setFiltroModelo(""); }} className={selectClass}>
                  <option value="">Marca</option>
                  {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <div className="relative">
                <select value={filtroModelo} onChange={(e) => setFiltroModelo(e.target.value)} className={selectClass} disabled={modelos.length === 0}>
                  <option value="">Modelo</option>
                  {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <div className="relative">
                <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)} className={selectClass}>
                  <option value="">Ano</option>
                  {anos.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <div className="relative">
                <select value={filtroPreco} onChange={(e) => setFiltroPreco(e.target.value)} className={selectClass}>
                  <option value="">Preço máx.</option>
                  <option value="30000">Até R$ 30.000</option>
                  <option value="50000">Até R$ 50.000</option>
                  <option value="80000">Até R$ 80.000</option>
                  <option value="100000">Até R$ 100.000</option>
                  <option value="150000">Até R$ 150.000</option>
                  <option value="200000">Até R$ 200.000</option>
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Banner Propaganda ── */}
      <div className="bg-[#e2e2de] border-y border-gray-300 overflow-hidden relative">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_20px,rgba(220,38,38,0.06)_20px,rgba(220,38,38,0.06)_21px)]" />
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-center relative">
          <p className="text-center">
            <span className="text-gray-900 font-black uppercase italic tracking-tight text-lg md:text-2xl">MELHOR AVALIAÇÃO DO SEU USADO</span>
            <span className="text-red-600 font-black uppercase italic tracking-tight text-lg md:text-2xl"> — VENHA CONFERIR</span>
          </p>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {filtrosAtivos && (
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-6">
            {estoqueFiltrado.length} veículo{estoqueFiltrado.length !== 1 ? "s" : ""} encontrado{estoqueFiltrado.length !== 1 ? "s" : ""}
          </p>
        )}

        {estoqueFiltrado.length > 0 ? (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {estoqueFiltrado.map((carro) => {
              const img = carro.capa_marketing_url ?? carro.fotos?.[0];
              const preco = fmt(carro.preco_sugerido ?? 0);
              const selos = selosAtivos(carro);
              const msgWhats = encodeURIComponent(
                `Olá! Vi o *${carro.marca} ${carro.modelo} ${carro.ano_modelo ?? ""}* na vitrine da ${nomeEmpresa} e tenho interesse. Ainda disponível?`
              );

              return (
                <div key={carro.id} className="bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col">

                  {/* Foto */}
                  <Link href={`/vitrine/${tenant}/${carro.id}`} className="block relative aspect-video overflow-hidden bg-gray-100 flex-shrink-0">
                    {img ? (
                      <img src={img} alt={carro.modelo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300"><Zap size={32} /></div>
                    )}
                    {carro.video_url && (
                      <div className="absolute top-3 right-3 bg-red-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-lg">
                        <Play size={8} className="fill-white" /> Vídeo
                      </div>
                    )}
                  </Link>

                  {/* Selos abaixo da foto */}
                  {selos.length > 0 && (
                    <div className="flex flex-wrap gap-0 border-b border-gray-100">
                      {selos.map(({ key, label, color }) => (
                        <span key={key} className={`${color} text-[9px] font-black uppercase tracking-widest px-3 py-1.5 flex-1 text-center`}>
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Info */}
                  <div className="p-6 flex flex-col flex-1">
                    <Link href={`/vitrine/${tenant}/${carro.id}`}>
                      <h2 className="text-xl font-black uppercase italic tracking-tight leading-none text-gray-900 group-hover:text-red-600 transition-colors">
                        {carro.marca} {carro.modelo}
                      </h2>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5">
                        {carro.versao ?? "—"} • {carro.ano_modelo ?? "—"}
                      </p>
                    </Link>
                    <div className="mt-4 pt-4 border-t border-gray-50 mb-5 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Preço</p>
                        <p className="text-2xl font-black tracking-tighter text-gray-900">{preco}</p>
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setModalCarro(carro); }}
                        className="text-[8px] font-black uppercase tracking-widest text-gray-400 hover:text-red-600 underline underline-offset-2 transition-colors whitespace-nowrap pb-1"
                      >
                        ou simular
                      </button>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2">
                      <a
                        href={`https://wa.me/${whatsapp}?text=${msgWhats}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 bg-green-500 hover:bg-green-400 text-white py-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MessageCircle size={12} /> WhatsApp
                      </a>
                      <Link
                        href={`/vitrine/${tenant}/${carro.id}`}
                        className="flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 py-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Ver detalhes <ArrowRight size={11} />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-32 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-white">
            <Zap size={32} className="mx-auto text-gray-300 mb-4" />
            <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">
              {filtrosAtivos ? "Nenhum veículo com esses filtros" : "Pátio sendo reabastecido…"}
            </p>
            {filtrosAtivos && (
              <button onClick={limparFiltros} className="mt-4 text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600">
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 py-8 text-center bg-white">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">© 2026 {nomeEmpresa} • Pátio Digital</p>
      </footer>


      {modalCarro && <ModalFinanciamento carro={modalCarro} whatsapp={whatsapp} nomeEmpresa={nomeEmpresa} onClose={() => setModalCarro(null)} />}
    </div>
  );
}
