"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PortalCarro } from "@/lib/portal/query";
import {
  Search, MapPin, Gauge, Fuel, Cog, Video, ShieldCheck, BadgeCheck,
  TrendingDown, MessageCircle, X, Car, ArrowRight,
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

// Atalhos por estilo de vida e faixa de preço (briefing). Predicados sobre o
// dado real — presets com 0 resultado são escondidos (nunca parece vazio).
const PRESETS: { id: string; label: string; grupo: "estilo" | "preco"; pred: (c: PortalCarro) => boolean }[] = [
  { id: "familia",  label: "Pra família",      grupo: "estilo", pred: (c) => ["SUV", "Sedan", "Utilitário"].includes(c.categoria ?? "") },
  { id: "primeiro", label: "Primeiro carro",   grupo: "estilo", pred: (c) => c.categoria === "Hatch" && (c.preco ?? Infinity) <= 60000 },
  { id: "app",      label: "Motorista de app", grupo: "estilo", pred: (c) => c.combustivel === "Flex" && ["Sedan", "Hatch"].includes(c.categoria ?? "") && (c.preco ?? Infinity) <= 90000 },
  { id: "economico",label: "Econômico",        grupo: "estilo", pred: (c) => (c.preco ?? Infinity) <= 45000 },
  { id: "ate40",    label: "Até R$ 40 mil",    grupo: "preco",  pred: (c) => (c.preco ?? Infinity) <= 40000 },
  { id: "p4070",    label: "R$ 40–70 mil",     grupo: "preco",  pred: (c) => (c.preco ?? 0) > 40000 && (c.preco ?? 0) <= 70000 },
  { id: "p70100",   label: "R$ 70–100 mil",    grupo: "preco",  pred: (c) => (c.preco ?? 0) > 70000 && (c.preco ?? 0) <= 100000 },
  { id: "acima100", label: "Acima de R$ 100 mil", grupo: "preco", pred: (c) => (c.preco ?? 0) > 100000 },
];

export default function CarrosVitrine({ carros, totalLojas }: { carros: PortalCarro[]; totalLojas: number }) {
  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [ano, setAno] = useState("");
  const [precoMax, setPrecoMax] = useState("");
  const [uf, setUf] = useState("");
  const [preset, setPreset] = useState("");
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

  // Carro de destaque pro hero: o mais premium (maior preço) com marca e foto.
  const destaque = useMemo(() => {
    const full = carros.filter((c) => c.foto && c.preco && c.marca);
    const pool = full.length ? full : carros.filter((c) => c.foto);
    return pool.length ? [...pool].sort((a, b) => (b.preco ?? 0) - (a.preco ?? 0))[0] : null;
  }, [carros]);

  const presetCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of PRESETS) m[p.id] = carros.filter(p.pred).length;
    return m;
  }, [carros]);

  // ── Filtro + ordenação ────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const presetDef = preset ? PRESETS.find((p) => p.id === preset) : null;
    let r = carros.filter((c) => {
      if (presetDef && !presetDef.pred(c)) return false;
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
  }, [carros, busca, marca, categoria, ano, uf, precoMax, preset, ordenar]);

  const temFiltro = !!(busca || marca || categoria || ano || precoMax || uf || preset);
  const limpar = () => { setBusca(""); setMarca(""); setCategoria(""); setAno(""); setPrecoMax(""); setUf(""); setPreset(""); };

  const selectCls =
    "appearance-none bg-white border border-gray-200 rounded-xl pl-3.5 pr-8 py-2.5 text-sm font-bold text-gray-700 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer";

  return (
    <div>
      {/* ══ HERO (claro, 2 colunas — estilo AutoNexus) ══ */}
      <section className="relative overflow-hidden bg-gradient-to-b from-white to-[#f1f1ef] border-b border-gray-200">
        <div className="absolute -top-24 -right-24 w-[380px] h-[380px] rounded-full bg-red-500/10 blur-[120px] pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-5 py-12 lg:py-16 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
          {/* ESQUERDA */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400 mb-4">
              / PORTAL DE SEMINOVOS E USADOS
            </div>
            <h1 className="font-bold tracking-[-0.03em] leading-[0.97] text-gray-900" style={{ fontSize: "clamp(40px, 5.5vw, 68px)" }}>
              Encontre seu próximo
              <br />
              <span className="text-red-600">carro com confiança.</span>
            </h1>
            <p className="mt-5 max-w-lg text-gray-500 text-[16px] leading-relaxed">
              Seminovos e usados de revendas verificadas — fotos, vídeo e atendimento na hora pelo
              WhatsApp. Sem formulário que ninguém responde.
            </p>

            {/* Busca */}
            <div className="mt-7 max-w-xl">
              <div className="flex items-center gap-2 bg-white rounded-2xl pl-4 pr-2 py-2 shadow-lg shadow-gray-200/60 ring-1 ring-gray-100">
                <Search size={20} className="text-gray-400 shrink-0" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Busque por marca, modelo ou cidade…"
                  className="flex-1 bg-transparent text-gray-900 placeholder:text-gray-400 text-[15px] py-2 focus:outline-none"
                />
                {busca ? (
                  <button onClick={() => setBusca("")} className="text-gray-400 hover:text-gray-700 p-2"><X size={16} /></button>
                ) : (
                  <a href="#estoque" className="w-10 h-10 rounded-xl bg-red-600 hover:bg-red-700 grid place-items-center text-white transition shrink-0">
                    <ArrowRight size={18} />
                  </a>
                )}
              </div>
            </div>

            {/* Selos de confiança */}
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {[
                { icon: <ShieldCheck size={14} />, t: "Revendas verificadas" },
                { icon: <Video size={14} />, t: "Vídeo de verdade" },
                { icon: <MessageCircle size={14} />, t: "Atendimento na hora" },
              ].map((b) => (
                <span key={b.t} className="flex items-center gap-1.5 text-[12px] font-bold text-gray-600">
                  <span className="text-red-600">{b.icon}</span> {b.t}
                </span>
              ))}
            </div>

            {/* Stat */}
            <div className="mt-6 flex items-center gap-5 text-gray-900">
              <Stat n={`${carros.length}`} label="carros" />
              <span className="w-px h-8 bg-gray-200" />
              <Stat n={`${marcas.length}`} label="marcas" />
              <span className="w-px h-8 bg-gray-200" />
              <Stat n={`${totalLojas}`} label={totalLojas === 1 ? "revenda" : "revendas"} />
            </div>
          </div>

          {/* DIREITA — carro de destaque (preenche o espaço) */}
          {destaque && (
            <div className="relative">
              {/* badge flutuante estilo "830+ Cars Available" */}
              <div className="hidden sm:flex flex-col items-center absolute -top-4 -right-2 z-10 bg-white rounded-2xl shadow-xl shadow-gray-300/50 px-5 py-2.5 ring-1 ring-gray-100">
                <span className="text-2xl font-black tracking-tighter text-gray-900">{carros.length}</span>
                <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 -mt-0.5">disponíveis</span>
              </div>

              <Link href={`/carros/${destaque.id}`} className="group block relative rounded-[2rem] overflow-hidden shadow-2xl shadow-gray-400/30 aspect-[4/3] bg-gray-900">
                <img src={destaque.foto!} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60" />
                <img src={destaque.foto!} alt={`${destaque.marca} ${destaque.modelo}`} className="absolute inset-0 w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <span className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow">
                  ★ Destaque
                </span>
                <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">{destaque.loja.nome}</p>
                  <h3 className="text-xl sm:text-2xl font-black uppercase italic tracking-tight leading-none">
                    {[destaque.marca, destaque.modelo].filter(Boolean).join(" ")}
                  </h3>
                  <div className="flex items-end justify-between mt-2">
                    <p className="text-[11px] text-white/70 font-bold uppercase tracking-wider">{[destaque.ano, fmtKm(destaque.km)].filter(Boolean).join(" • ")}</p>
                    <p className="text-2xl font-black tracking-tighter">{fmtBRL(destaque.preco)}</p>
                  </div>
                </div>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ══ EXPLORAR POR CARROCERIA / ESTILO / PREÇO ══ */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-5 py-6 flex flex-col gap-5">
          {categorias.length > 0 && (
            <ChipRow titulo="Carroceria">
              {categorias.map(([cat, n]) => (
                <ChipBtn key={cat} ativo={categoria === cat} onClick={() => setCategoria(categoria === cat ? "" : cat)}>
                  {cat} <span className="opacity-50">{n}</span>
                </ChipBtn>
              ))}
            </ChipRow>
          )}
          <PresetRow titulo="Pra quem é o carro" grupo="estilo" preset={preset} setPreset={setPreset} counts={presetCounts} />
          <PresetRow titulo="Por faixa de preço" grupo="preco" preset={preset} setPreset={setPreset} counts={presetCounts} />
        </div>
      </section>

      {/* ══ POR QUE COMPRAR AQUI ══ */}
      <section className="bg-[#f7f7f5] border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-5 py-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: <ShieldCheck size={16} />, t: "Revendas verificadas", d: "Lojas reais, estoque conferido" },
            { icon: <Video size={16} />, t: "Vídeo de verdade", d: "Veja o carro, não só foto" },
            { icon: <MessageCircle size={16} />, t: "Atendimento na hora", d: "Cai direto no WhatsApp da loja" },
            { icon: <TrendingDown size={16} />, t: "Preço transparente", d: "FIPE na ficha, sem taxa oculta" },
          ].map((b) => (
            <div key={b.t} className="flex items-start gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-red-50 text-red-600 grid place-items-center shrink-0">{b.icon}</span>
              <div>
                <p className="text-[12px] font-black uppercase tracking-wide text-gray-900 leading-tight">{b.t}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{b.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ FILTROS ══ */}
      <div id="estoque" className="sticky top-16 z-30 bg-[#f7f7f5]/90 backdrop-blur border-b border-gray-200 scroll-mt-16">
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
            <button onClick={limpar} className="flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 px-2">
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
            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Nenhum carro com esses filtros</p>
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

// ─── Subcomponentes ───────────────────────────────────────────────────────────
function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <p className="text-2xl font-black tracking-tighter leading-none">{n}<span className="text-red-600">+</span></p>
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1">{label}</p>
    </div>
  );
}

function ChipRow({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 mb-2">{titulo}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ChipBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition ${
        ativo ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-gray-400"
      }`}
    >
      {children}
    </button>
  );
}

function PresetRow({ titulo, grupo, preset, setPreset, counts }: {
  titulo: string; grupo: "estilo" | "preco"; preset: string; setPreset: (v: string) => void; counts: Record<string, number>;
}) {
  const items = PRESETS.filter((p) => p.grupo === grupo && counts[p.id] > 0);
  if (items.length === 0) return null;
  return (
    <ChipRow titulo={titulo}>
      {items.map((p) => (
        <ChipBtn key={p.id} ativo={preset === p.id} onClick={() => setPreset(preset === p.id ? "" : p.id)}>
          {p.label}
        </ChipBtn>
      ))}
    </ChipRow>
  );
}

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

  return (
    <article className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
      {/* Foto */}
      <Link href={`/carros/${c.id}`} className="relative aspect-[4/3] bg-gray-100 overflow-hidden block">
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
      </Link>

      {/* Info */}
      <div className="p-5 flex flex-col flex-1">
        <Link href={`/carros/${c.id}`}>
          <h2 className="text-[17px] font-black uppercase italic tracking-tight leading-none text-gray-900 hover:text-red-600 transition">{titulo}</h2>
        </Link>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5 line-clamp-1">
          {[c.versao, c.ano].filter(Boolean).join(" • ") || "—"}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-gray-500 font-semibold">
          {fmtKm(c.km) && <span className="flex items-center gap-1"><Gauge size={11} /> {fmtKm(c.km)}</span>}
          {c.combustivel && <span className="flex items-center gap-1"><Fuel size={11} /> {c.combustivel}</span>}
          {c.cambio && <span className="flex items-center gap-1"><Cog size={11} /> {c.cambio}</span>}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-50">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Preço</p>
          <p className="text-2xl font-black tracking-tighter text-gray-900">{fmtBRL(c.preco)}</p>
        </div>

        <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
          <span className="truncate">{c.loja.nome ?? "Revenda verificada"}</span>
          {local && <span className="flex items-center gap-1 shrink-0"><MapPin size={10} /> {local}</span>}
        </div>

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
