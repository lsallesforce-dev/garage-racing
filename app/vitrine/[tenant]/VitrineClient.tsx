"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Zap, MessageCircle, Play, Shield, Award,
  X, ChevronDown, SlidersHorizontal,
} from "lucide-react";

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ─── Modal de Financiamento ───────────────────────────────────────────────────

function ModalFinanciamento({
  carro,
  whatsapp,
  onClose,
}: {
  carro: any;
  whatsapp: string;
  onClose: () => void;
}) {
  const preco = carro.preco_sugerido ?? 0;
  const [entrada, setEntrada] = useState("");
  const [parcelas, setParcelas] = useState("48");

  const entradaNum = parseFloat(entrada) || 0;
  const parcelasNum = parseInt(parcelas) || 1;
  const saldo = Math.max(preco - entradaNum, 0);
  const valorParcela = saldo / parcelasNum;

  const msgWpp = encodeURIComponent(
    `Olá! Fiz uma simulação do ${carro.marca} ${carro.modelo} ${carro.ano_modelo ?? ""}: entrada de ${fmt(entradaNum)}, ${parcelas}x de ~${fmt(valorParcela)}. Podemos conversar?`
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
              Simulação de Financiamento
            </p>
            <h3 className="text-xl font-black uppercase italic tracking-tight text-gray-900">
              {carro.marca} {carro.modelo}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-6">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Valor do veículo</p>
          <p className="text-2xl font-black tracking-tighter text-gray-900">{fmt(preco)}</p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Entrada (R$)</label>
            <input
              type="number"
              placeholder="Ex: 15000"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Parcelas desejadas</label>
            <div className="relative">
              <select
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
                className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-red-500 pr-10"
              >
                {[12, 24, 36, 48, 60, 72].map((n) => (
                  <option key={n} value={n}>{n}x</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {saldo > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-6">
            <p className="text-[8px] font-black uppercase tracking-widest text-red-400 mb-1">Estimativa de parcela</p>
            <p className="text-3xl font-black tracking-tighter text-red-600">
              {fmt(valorParcela)}<span className="text-sm font-bold text-red-400"> /mês</span>
            </p>
            <p className="text-[9px] text-red-400 mt-1">Simulação sem juros. Taxa final sujeita à análise de crédito.</p>
          </div>
        )}

        <a
          href={`https://wa.me/${whatsapp}?text=${msgWpp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-400 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <MessageCircle size={16} /> Enviar simulação no WhatsApp
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
}

export default function VitrineClient({ tenant, nomeEmpresa, whatsapp, estoque }: Props) {
  const [modalCarro, setModalCarro] = useState<any | null>(null);
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroModelo, setFiltroModelo] = useState("");
  const [filtroAno, setFiltroAno] = useState("");
  const [filtroPreco, setFiltroPreco] = useState("");

  const marcas = useMemo(
    () => [...new Set(estoque.map((c) => c.marca).filter(Boolean))].sort(),
    [estoque]
  );
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

  function limparFiltros() {
    setFiltroMarca(""); setFiltroModelo(""); setFiltroAno(""); setFiltroPreco("");
  }

  const selectClass = "appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 pr-8 w-full cursor-pointer";

  return (
    <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-black uppercase italic tracking-tighter text-gray-900">{nomeEmpresa}</span>
          <a
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Olá! Preciso de ajuda para escolher um veículo.")}`}
            target="_blank" rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-600 hover:text-green-500 transition-colors"
          >
            <MessageCircle size={14} /> Falar com consultor
          </a>
        </div>
      </header>

      {/* Hero + Filtro */}
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

      {/* Faixa de Confiança */}
      <div className="bg-white border-b border-gray-100 py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-center gap-8">
          <div className="flex items-center gap-2.5 text-gray-500">
            <Shield size={15} className="text-red-500 flex-shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-widest">Vistoria Cautelar Inclusa</span>
          </div>
          <div className="flex items-center gap-2.5 text-gray-500">
            <Award size={15} className="text-red-500 flex-shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-widest">Melhor Avaliação na Troca</span>
          </div>
        </div>
      </div>

      {/* Grid */}
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
              const unicoDono = carro.segundo_dono === false;
              const msgWhats = encodeURIComponent(
                `Olá! Vi o *${carro.marca} ${carro.modelo} ${carro.ano_modelo ?? ""}* na vitrine da ${nomeEmpresa} e tenho interesse. Ainda disponível?`
              );

              return (
                <div key={carro.id} className="bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col">
                  <Link href={`/vitrine/${tenant}/${carro.id}`} className="block relative aspect-video overflow-hidden bg-gray-100 flex-shrink-0">
                    {img ? (
                      <img src={img} alt={carro.modelo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300"><Zap size={32} /></div>
                    )}
                    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                      <span className="bg-white/90 backdrop-blur-sm text-gray-700 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">Verificado</span>
                      {unicoDono && (
                        <span className="bg-blue-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">Único Dono</span>
                      )}
                    </div>
                    {carro.video_url && (
                      <div className="absolute top-3 right-3 bg-red-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-lg">
                        <Play size={8} className="fill-white" /> Vídeo
                      </div>
                    )}
                  </Link>

                  <div className="p-6 flex flex-col flex-1">
                    <Link href={`/vitrine/${tenant}/${carro.id}`}>
                      <h2 className="text-xl font-black uppercase italic tracking-tight leading-none text-gray-900 group-hover:text-red-600 transition-colors">
                        {carro.marca} {carro.modelo}
                      </h2>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5">
                        {carro.versao ?? "—"} • {carro.ano_modelo ?? "—"}
                      </p>
                    </Link>
                    <div className="mt-4 pt-4 border-t border-gray-50 mb-5">
                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Preço</p>
                      <p className="text-2xl font-black tracking-tighter text-gray-900">{preco}</p>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setModalCarro(carro)}
                        className="flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 py-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-colors"
                      >
                        Simular
                      </button>
                      <a
                        href={`https://wa.me/${whatsapp}?text=${msgWhats}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 bg-green-500 hover:bg-green-400 text-white py-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MessageCircle size={12} /> WhatsApp
                      </a>
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

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 text-center bg-white">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">© 2026 {nomeEmpresa} • Pátio Digital</p>
      </footer>

      {/* FAB WhatsApp */}
      <div className="fixed bottom-6 right-6 z-50">
        <a
          href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Olá! Preciso de ajuda para escolher um veículo.")}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 bg-green-500 hover:bg-green-400 text-white pl-4 pr-5 py-3.5 rounded-full shadow-2xl transition-all hover:scale-105 active:scale-95"
        >
          <MessageCircle size={18} strokeWidth={2.5} />
          <span className="font-black uppercase text-[9px] tracking-widest">Falar agora</span>
        </a>
      </div>

      {modalCarro && (
        <ModalFinanciamento carro={modalCarro} whatsapp={whatsapp} onClose={() => setModalCarro(null)} />
      )}
    </div>
  );
}
