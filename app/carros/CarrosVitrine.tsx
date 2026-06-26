"use client";

import { useMemo, useState } from "react";
import type { PortalCarro } from "@/lib/portal/query";
import {
  Search, MapPin, Gauge, Fuel, Cog, Video, ShieldCheck, BadgeCheck,
  TrendingDown, MessageCircle, X, Car,
} from "lucide-react";

const fmtBRL = (v: number | null) =>
  v == null
    ? "Sob consulta"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
const fmtKm = (v: number | null) => (v == null ? null : `${new Intl.NumberFormat("pt-BR").format(v)} km`);

function uniqSorted(arr: (string | null | undefined)[]): string[] {
  return [...new Set(arr.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

type Ordenar = "recentes" | "preco_asc" | "preco_desc";

export default function CarrosVitrine({ carros, totalLojas }: { carros: PortalCarro[]; totalLojas: number }) {
  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [ano, setAno] = useState("");
  const [precoMax, setPrecoMax] = useState("");
  const [uf, setUf] = useState("");
  const [ordenar, setOrdenar] = useState<Ordenar>("recentes");

  // ── Facets derivados do estoque real ──────────────────────────────────────
  const marcas = useMemo(() => uniqSorted(carros.map((c) => c.marca)), [carros]);
  const categorias = useMemo(() => {
    const m = new Map<string, number>();
    carros.forEach((c) => { if (c.categoria) m.set(c.categoria, (m.get(c.categoria) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [carros]);
  const anos = useMemo(
    () => uniqSorted(carros.map((c) => c.ano?.toString())).sort((a, b) => Number(b) - Number(a)),
    [carros]
  );
  const ufs = useMemo(() => uniqSorted(carros.map((c) => c.uf)), [carros]);

  // ── Filtro + ordenação ────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let r = carros.filter((c) => {
      if (marca && c.marca !== marca) return false;
      if (categoria && c.categoria !== categoria) return false;
      if (ano && String(c.ano) !== ano) return false;
      if (uf && c.uf !== uf) return false;
      if (precoMax && (c.preco ?? Infinity) > Number(precoMax)) return false;
      if (q) {
        const hay = `${c.marca ?? ""} ${c.modelo ?? ""} ${c.versao ?? ""} ${c.cidade ?? ""} ${c.categoria ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (ordenar === "preco_asc") r = [...r].sort((a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity));
    if (ordenar === "preco_desc") r = [...r].sort((a, b) => (b.preco ?? -1) - (a.preco ?? -1));
    return r;
  }, [carros, busca, marca, categoria, ano, uf, precoMax, ordenar]);

  const temFiltro = !!(busca || marca || categoria || ano || precoMax || uf);
  const limpar = () => { setBusca(""); setMarca(""); setCategoria(""); setAno(""); setPrecoMax(""); setUf(""); };

  const selectCls =
    "appearance-none bg-white border border-gray-200 rounded-xl pl-3.5 pr-8 py-2.5 text-sm font-bold text-gray-700 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer";

  return (
    <div>
      {/* ══ HERO ══ */}
      <section className="relative bg-[#161616] text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-50 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="absolute -top-32 -right-24 w-[460px] h-[460px] rounded-full bg-[#ef4444]/25 blur-[120px] pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-5 pt-16 pb-12">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50 mb-5">
            / PORTAL DE SEMINOVOS E USADOS
          </div>
          <h1 className="font-bold tracking-[-0.03em] leading-[0.98]" style={{ fontSize: "clamp(38px, 6vw, 76px)" }}>
            Encontre seu próximo
            <br />
            <span className="text-[#ef4444]">carro.</span>
          </h1>
          <p className="mt-5 max-w-xl text-white/70 text-[16px] leading-relaxed">
            Seminovos e usados de revendas verificadas — com fotos, vídeo e atendimento na hora pelo WhatsApp.
            Sem formulário que ninguém responde.
          </p>

          {/* Busca */}
          <div className="mt-8 max-w-2xl">
            <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-1 shadow-2xl shadow-black/30">
              <Search size={20} className="text-gray-400 shrink-0" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Busque por marca, modelo ou cidade…"
                className="flex-1 bg-transparent text-gray-900 placeholder:text-gray-400 text-[15px] py-3.5 focus:outline-none"
              />
              {busca && (
                <button onClick={() => setBusca("")} className="text-gray-400 hover:text-gray-700 p-1">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Stat */}
          <div className="mt-6 flex items-center gap-2.5 text-[12px] font-mono uppercase tracking-[0.18em] text-white/45">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
            {carros.length} carros · {totalLojas} {totalLojas === 1 ? "revenda verificada" : "revendas verificadas"}
          </div>

          {/* Carrocerias */}
          {categorias.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {categorias.map(([cat, n]) => {
                const ativo = categoria === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setCategoria(ativo ? "" : cat)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-black uppercase tracking-widest transition ${
                      ativo
                        ? "bg-[#ef4444] text-white"
                        : "bg-white/10 text-white/80 hover:bg-white/15 ring-1 ring-inset ring-white/10"
                    }`}
                  >
                    {cat}
                    <span className={ativo ? "text-white/70" : "text-white/40"}>{n}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ══ FILTROS ══ */}
      <div className="sticky top-16 z-30 bg-[#f7f7f5]/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-5 py-3 flex flex-wrap items-center gap-2.5">
          <Select value={marca} onChange={setMarca} cls={selectCls} placeholder="Marca" options={marcas} />
          <Select value={categoria} onChange={setCategoria} cls={selectCls} placeholder="Carroceria" options={categorias.map(([c]) => c)} />
          <Select value={ano} onChange={setAno} cls={selectCls} placeholder="Ano" options={anos} />
          <Select value={uf} onChange={setUf} cls={selectCls} placeholder="UF" options={ufs} />
          <div className="relative">
            <select value={precoMax} onChange={(e) => setPrecoMax(e.target.value)} className={selectCls}>
              <option value="">Preço máx.</option>
              {[30000, 50000, 80000, 100000, 150000, 200000].map((p) => (
                <option key={p} value={p}>{fmtBRL(p)}</option>
              ))}
            </select>
            <Chevron />
          </div>
          <div className="relative ml-auto">
            <select value={ordenar} onChange={(e) => setOrdenar(e.target.value as Ordenar)} className={selectCls}>
              <option value="recentes">Mais recentes</option>
              <option value="preco_asc">Menor preço</option>
              <option value="preco_desc">Maior preço</option>
            </select>
            <Chevron />
          </div>
          {temFiltro && (
            <button
              onClick={limpar}
              className="flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 px-2"
            >
              <X size={13} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* ══ GRID ══ */}
      <section className="max-w-7xl mx-auto px-5 py-10">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-6">
          {filtrados.length} {filtrados.length === 1 ? "veículo encontrado" : "veículos encontrados"}
        </p>

        {filtrados.length > 0 ? (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((c) => <Card key={c.id} c={c} />)}
          </div>
        ) : (
          <div className="py-28 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-white">
            <Car size={32} className="mx-auto text-gray-300 mb-4" />
            <p className="text-xs font-black uppercase tracking-widest text-gray-400">
              Nenhum carro com esses filtros
            </p>
            {temFiltro && (
              <button onClick={limpar} className="mt-4 text-[11px] font-black uppercase tracking-widest text-red-500 hover:text-red-600">
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Select com chevron ───────────────────────────────────────────────────────
function Select({
  value, onChange, options, placeholder, cls,
}: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string; cls: string;
}) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <Chevron />
    </div>
  );
}

function Chevron() {
  return (
    <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ─── Card do veículo ──────────────────────────────────────────────────────────
function Card({ c }: { c: PortalCarro }) {
  const titulo = [c.marca, c.modelo].filter(Boolean).join(" ") || c.modelo || "Veículo";
  const local = [c.cidade, c.uf].filter(Boolean).join(" · ");
  const msg = encodeURIComponent(
    `Olá! Vi o ${[c.marca, c.modelo, c.ano].filter(Boolean).join(" ")} no portal AutoZap e tenho interesse. Ainda está disponível?`
  );
  const wa = c.loja.whatsapp ? `https://wa.me/${c.loja.whatsapp.replace(/\D/g, "")}?text=${msg}` : null;
  const specs = [fmtKm(c.km), c.combustivel, c.cambio].filter(Boolean) as string[];

  return (
    <article className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
      {/* Foto */}
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
        {c.foto && (
          <>
            <img src={c.foto} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70" />
            <img src={c.foto} alt={titulo} loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
          </>
        )}
        {/* Badges esquerda */}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {c.temVideo && (
            <span className="flex items-center gap-1 bg-red-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow">
              <Video size={9} className="fill-white" /> Vídeo
            </span>
          )}
          {c.selos.abaixoFipe && (
            <span className="flex items-center gap-1 bg-[#22c55e] text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow">
              <TrendingDown size={9} /> Abaixo da FIPE
            </span>
          )}
        </div>
        {/* Badges direita */}
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
          {(c.selos.vistoriado || c.selos.cautelar) && (
            <span className="flex items-center gap-1 bg-white/90 backdrop-blur text-gray-700 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
              <ShieldCheck size={9} className="text-[#22c55e]" /> Vistoriado
            </span>
          )}
          {c.selos.unicoDono && (
            <span className="flex items-center gap-1 bg-blue-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
              <BadgeCheck size={9} /> Único Dono
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-5 flex flex-col flex-1">
        <h2 className="text-[17px] font-black uppercase italic tracking-tight leading-none text-gray-900">{titulo}</h2>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5 line-clamp-1">
          {[c.versao, c.ano].filter(Boolean).join(" • ") || "—"}
        </p>

        {specs.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-gray-500 font-semibold">
            {fmtKm(c.km) && <span className="flex items-center gap-1"><Gauge size={11} /> {fmtKm(c.km)}</span>}
            {c.combustivel && <span className="flex items-center gap-1"><Fuel size={11} /> {c.combustivel}</span>}
            {c.cambio && <span className="flex items-center gap-1"><Cog size={11} /> {c.cambio}</span>}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-gray-50">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Preço</p>
          <p className="text-2xl font-black tracking-tighter text-gray-900">{fmtBRL(c.preco)}</p>
        </div>

        {/* Loja + local */}
        <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
          <span className="truncate">{c.loja.nome ?? "Revenda verificada"}</span>
          {local && <span className="flex items-center gap-1 shrink-0"><MapPin size={10} /> {local}</span>}
        </div>

        {/* CTA — o moat: cai direto no WhatsApp do agente */}
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition active:scale-[0.98]"
          >
            <MessageCircle size={14} /> Falar com a loja
          </a>
        ) : (
          <div className="mt-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-300 py-3">
            Contato indisponível
          </div>
        )}
      </div>
    </article>
  );
}
