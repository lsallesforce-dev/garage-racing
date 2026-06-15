"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  MessageCircle, Play, X, ChevronDown, SlidersHorizontal,
  ArrowRight, Zap, RotateCcw,
} from "lucide-react";

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

function fmtKm(v: number) {
  return new Intl.NumberFormat("pt-BR").format(v) + " km";
}

// ─── Selos ────────────────────────────────────────────────────────────────────

const SELOS: { key: string; label: string; color: string }[] = [
  { key: "segundo_dono_false", label: "Único Dono",        color: "bg-blue-600 text-white" },
  { key: "vistoriado",         label: "Vistoriado",        color: "bg-green-600 text-white" },
  { key: "vistoria_cautelar",  label: "Vistoria Cautelar", color: "bg-teal-600 text-white" },
  { key: "abaixo_fipe",        label: "Abaixo FIPE",       color: "bg-orange-500 text-white" },
  { key: "de_repasse",         label: "De Repasse",        color: "bg-purple-600 text-white" },
];

function selosAtivos(carro: any) {
  return SELOS.filter(({ key }) => {
    if (key === "segundo_dono_false") return carro.segundo_dono === false;
    return carro[key] === true;
  });
}

// ─── Preços predefinidos ──────────────────────────────────────────────────────

const FAIXAS_PRECO = [
  { label: "Até R$ 30 mil",   value: 30000 },
  { label: "Até R$ 50 mil",   value: 50000 },
  { label: "Até R$ 80 mil",   value: 80000 },
  { label: "Até R$ 100 mil",  value: 100000 },
  { label: "Até R$ 150 mil",  value: 150000 },
  { label: "Até R$ 200 mil",  value: 200000 },
];

// ─── Modal de Financiamento ───────────────────────────────────────────────────

function ModalFinanciamento({
  carro, whatsapp, nomeEmpresa, onClose,
}: { carro: any; whatsapp: string; nomeEmpresa: string; onClose: () => void }) {
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
          className="flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-400 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all">
          <MessageCircle size={16} /> Solicitar simulação real
        </a>
      </div>
    </div>
  );
}

// ─── Checkbox item ─────────────────────────────────────────────────────────────

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
        checked ? "bg-red-600 border-red-600" : "border-gray-300 group-hover:border-red-400"
      }`}>
        {checked && (
          <svg viewBox="0 0 10 8" className="w-2.5 h-2" fill="none">
            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
    </label>
  );
}

// ─── Seção do sidebar ─────────────────────────────────────────────────────────

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">{title}</p>
      {children}
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Filtros
  const [filtroMarca, setFiltroMarca]           = useState("");
  const [filtroModelo, setFiltroModelo]         = useState("");
  const [filtroAno, setFiltroAno]               = useState("");
  const [filtroPreco, setFiltroPreco]           = useState(0);
  const [filtroCombustiveis, setFiltroCombust]  = useState<string[]>([]);
  const [filtroCategorias, setFiltroCateg]      = useState<string[]>([]);

  // Opções derivadas do estoque
  const marcas = useMemo(() =>
    [...new Set(estoque.map((c) => c.marca).filter(Boolean))].sort(), [estoque]);
  const modelos = useMemo(() =>
    [...new Set(estoque.filter((c) => !filtroMarca || c.marca === filtroMarca).map((c) => c.modelo).filter(Boolean))].sort(),
    [estoque, filtroMarca]);
  const anos = useMemo(() =>
    [...new Set(estoque.map((c) => c.ano_modelo).filter(Boolean))].sort((a, b) => b - a), [estoque]);
  const combustiveis = useMemo(() =>
    [...new Set(estoque.map((c) => c.combustivel).filter(Boolean))].sort(), [estoque]);
  const categorias = useMemo(() =>
    [...new Set(estoque.map((c) => c.categoria).filter(Boolean))].sort(), [estoque]);

  // Estoque filtrado
  const estoqueFiltrado = useMemo(() => estoque.filter((c) => {
    if (filtroMarca && c.marca !== filtroMarca) return false;
    if (filtroModelo && c.modelo !== filtroModelo) return false;
    if (filtroAno && String(c.ano_modelo) !== filtroAno) return false;
    if (filtroPreco > 0 && (c.preco_sugerido ?? 0) > filtroPreco) return false;
    if (filtroCombustiveis.length > 0 && !filtroCombustiveis.includes(c.combustivel)) return false;
    if (filtroCategorias.length > 0 && !filtroCategorias.includes(c.categoria)) return false;
    return true;
  }), [estoque, filtroMarca, filtroModelo, filtroAno, filtroPreco, filtroCombustiveis, filtroCategorias]);

  const filtrosAtivos = !!(filtroMarca || filtroModelo || filtroAno || filtroPreco || filtroCombustiveis.length || filtroCategorias.length);

  function limparFiltros() {
    setFiltroMarca(""); setFiltroModelo(""); setFiltroAno("");
    setFiltroPreco(0); setFiltroCombust([]); setFiltroCateg([]);
  }

  function toggleCombustivel(v: string) {
    setFiltroCombust((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v]);
  }
  function toggleCategoria(v: string) {
    setFiltroCateg((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v]);
  }

  const selectClass = "appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-red-500 w-full cursor-pointer";

  // ─── Sidebar content ──────────────────────────────────────────────────────
  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 pb-4 border-b border-gray-100">
        <span className="text-sm font-black uppercase tracking-widest text-gray-800">Filtros</span>
        {filtrosAtivos && (
          <button onClick={limparFiltros} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600">
            <RotateCcw size={10} /> Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-0">

        {/* Marca */}
        <SideSection title="Marca">
          <div className="relative">
            <select value={filtroMarca} onChange={(e) => { setFiltroMarca(e.target.value); setFiltroModelo(""); }} className={selectClass}>
              <option value="">Todas as marcas</option>
              {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </SideSection>

        {/* Modelo */}
        <SideSection title="Modelo">
          <div className="relative">
            <select value={filtroModelo} onChange={(e) => setFiltroModelo(e.target.value)} className={selectClass} disabled={modelos.length === 0}>
              <option value="">Todos os modelos</option>
              {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </SideSection>

        {/* Ano */}
        <SideSection title="Ano">
          <div className="relative">
            <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)} className={selectClass}>
              <option value="">Qualquer ano</option>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </SideSection>

        {/* Preço */}
        <SideSection title="Preço máximo">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {FAIXAS_PRECO.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFiltroPreco(filtroPreco === f.value ? 0 : f.value)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                    filtroPreco === f.value
                      ? "bg-red-600 border-red-600 text-white"
                      : "border-gray-200 text-gray-600 hover:border-red-300"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </SideSection>

        {/* Combustível */}
        {combustiveis.length > 0 && (
          <SideSection title="Combustível">
            <div className="space-y-2">
              {combustiveis.map((c) => (
                <CheckItem key={c} label={c} checked={filtroCombustiveis.includes(c)} onChange={() => toggleCombustivel(c)} />
              ))}
            </div>
          </SideSection>
        )}

        {/* Categoria */}
        {categorias.length > 0 && (
          <SideSection title="Categoria">
            <div className="space-y-2">
              {categorias.map((c) => (
                <CheckItem key={c} label={c} checked={filtroCategorias.includes(c)} onChange={() => toggleCategoria(c)} />
              ))}
            </div>
          </SideSection>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Mobile: botão filtros */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors"
            >
              <SlidersHorizontal size={13} /> Filtros
              {filtrosAtivos && <span className="w-1.5 h-1.5 rounded-full bg-red-600" />}
            </button>

            {logoUrl ? (
              <img src={logoUrl} alt={nomeEmpresa} className="h-10 w-auto object-contain" />
            ) : (
              <span className="text-lg font-black uppercase italic tracking-tighter text-gray-900">{nomeEmpresa}</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {estoqueFiltrado.length} veículo{estoqueFiltrado.length !== 1 ? "s" : ""}
            </span>
            <a
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Olá! Preciso de ajuda para escolher um veículo.")}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-white px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest transition-colors"
            >
              <MessageCircle size={13} /> Consultor
            </a>
          </div>
        </div>
      </header>

      {/* ── Drawer mobile ──────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[300px] bg-white shadow-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="font-black uppercase tracking-widest text-sm">Filtros</span>
              <button onClick={() => setSidebarOpen(false)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <X size={14} />
              </button>
            </div>
            {sidebarContent}
            <button
              onClick={() => setSidebarOpen(false)}
              className="mt-6 w-full bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl font-black uppercase tracking-widest text-[11px] transition-colors"
            >
              Ver {estoqueFiltrado.length} veículo{estoqueFiltrado.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Body: sidebar + grid ────────────────────────────────────────────── */}
      <div className="max-w-[1400px] mx-auto px-6 py-8 flex gap-8 items-start">

        {/* Sidebar desktop */}
        <aside className="hidden lg:block w-[260px] flex-shrink-0 sticky top-24 bg-white border border-gray-100 shadow-sm p-5">
          {sidebarContent}
        </aside>

        {/* Grid */}
        <main className="flex-1 min-w-0">
          {/* Topo do grid */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-base font-black uppercase tracking-widest text-gray-800">
              <span className="text-red-600">{estoqueFiltrado.length}</span> veículo{estoqueFiltrado.length !== 1 ? "s" : ""} disponíve{estoqueFiltrado.length !== 1 ? "is" : "l"}
            </h1>
            {filtrosAtivos && (
              <button onClick={limparFiltros} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600">
                <RotateCcw size={10} /> Limpar filtros
              </button>
            )}
          </div>

          {estoqueFiltrado.length > 0 ? (
            <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {estoqueFiltrado.map((carro) => {
                const img = carro.capa_marketing_url ?? carro.fotos?.[0];
                const selos = selosAtivos(carro);
                const msgWhats = encodeURIComponent(
                  `Olá! Vi o *${carro.marca} ${carro.modelo} ${carro.ano_modelo ?? ""}* na vitrine da ${nomeEmpresa} e tenho interesse. Ainda disponível?`
                );

                return (
                  <div key={carro.id} className="bg-white shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col">

                    {/* Foto */}
                    <Link href={`/vitrine/${tenant}/${carro.id}`} className="block relative flex-shrink-0 overflow-hidden bg-gray-200 aspect-video">
                      {img ? (
                        <>
                          {/* Fundo borrado preenche áreas vazias — foto fica INTEIRA */}
                          <img src={img} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-60" />
                          <img
                            src={img}
                            alt={`${carro.marca} ${carro.modelo}`}
                            className="absolute inset-0 w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500"
                          />
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-200"><Zap size={32} /></div>
                      )}
                      {carro.video_url && (
                        <div className="absolute top-2.5 right-2.5 bg-red-600 text-white px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1">
                          <Play size={7} className="fill-white" /> Vídeo
                        </div>
                      )}
                      {/* Selos sobrepostos no canto inferior */}
                      {selos.length > 0 && (
                        <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1">
                          {selos.map(({ key, label, color }) => (
                            <span key={key} className={`${color} text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full`}>
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </Link>

                    {/* Info */}
                    <div className="px-5 pt-4 pb-5 flex flex-col flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/vitrine/${tenant}/${carro.id}`} className="flex-1 min-w-0">
                          <h2 className="font-black text-[15px] text-gray-900 group-hover:text-red-600 transition-colors leading-tight truncate">
                            {carro.marca} {carro.modelo}
                          </h2>
                          {carro.versao && (
                            <p className="text-[10px] text-gray-400 font-semibold mt-0.5 truncate">{carro.versao}</p>
                          )}
                        </Link>
                        <span className="text-base font-black text-gray-900 whitespace-nowrap">
                          {fmt(carro.preco_sugerido ?? 0)}
                        </span>
                      </div>

                      {/* Specs */}
                      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-gray-400 font-medium flex-wrap">
                        {carro.ano_modelo && <span>{carro.ano_modelo}</span>}
                        {carro.ano_modelo && carro.quilometragem_estimada > 0 && <span>·</span>}
                        {carro.quilometragem_estimada > 0 && <span>{fmtKm(carro.quilometragem_estimada)}</span>}
                        {carro.combustivel && <span>·</span>}
                        {carro.combustivel && <span>{carro.combustivel}</span>}
                      </div>

                      {/* Botões */}
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <a
                          href={`https://wa.me/${whatsapp}?text=${msgWhats}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center gap-1.5 bg-green-500 hover:bg-green-400 text-white py-2.5 rounded-2xl font-black uppercase text-[9px] tracking-widest transition-colors"
                        >
                          <MessageCircle size={11} /> WhatsApp
                        </a>
                        <Link
                          href={`/vitrine/${tenant}/${carro.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-2xl font-black uppercase text-[9px] tracking-widest transition-colors"
                        >
                          Ver mais <ArrowRight size={10} />
                        </Link>
                      </div>

                      <button
                        onClick={() => setModalCarro(carro)}
                        className="mt-2.5 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 transition-colors text-center w-full"
                      >
                        Simular financiamento
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-32 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-white">
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
        </main>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 py-8 text-center bg-white mt-8">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">© 2026 {nomeEmpresa} • Pátio Digital</p>
      </footer>

      {modalCarro && (
        <ModalFinanciamento carro={modalCarro} whatsapp={whatsapp} nomeEmpresa={nomeEmpresa} onClose={() => setModalCarro(null)} />
      )}
    </div>
  );
}
