"use client";

// Layout PREMIUM da vitrine — home.
//
// Escolhido em `page.tsx` quando `vitrine_tema.layout === "premium"` (hoje só a
// APROVE Multimarcas, migration 054). O layout padrão continua em
// `VitrineClient.tsx`, INTOCADO — é a garantia mecânica de que Carmatti e as
// demos não quebram por causa desta tela.
//
// Mesma lógica de filtro/ordenação do layout padrão: os facets saem do estoque
// real, então marca/modelo/ano/chip que não tem carro não aparece na tela.

import { useMemo, useState } from "react";
import {
  ChevronDown, SlidersHorizontal, RotateCcw, Car, Search,
  Sparkles, ShieldCheck, MapPin,
} from "lucide-react";
import {
  resolveTheme, themeStyle, isRecemChegado, selosDe, chipsDe,
  type VitrineTema, type ChipRapido,
} from "../theme";
import FichaFinanciamento from "@/components/vitrine/FichaFinanciamento";
import { PremiumTopo, PremiumRodape, PremiumFab, localDaLoja, type LojaPremium } from "@/components/vitrine/premium/Chrome";
import { CarCardPremium, CardDestaque } from "@/components/vitrine/premium/CarCardPremium";

interface Props {
  tenant: string;
  nomeEmpresa: string;
  whatsapp: string;
  estoque: any[];
  logoUrl?: string | null;
  vitrineTema?: VitrineTema | null;
  loja: LojaPremium;
}

type Ordenar = "recentes" | "preco_asc" | "preco_desc";

const FAIXAS = [
  { id: "ate40", label: "Até R$ 40 mil", min: 0, max: 40000 },
  { id: "f4070", label: "R$ 40–70 mil", min: 40000, max: 70000 },
  { id: "f70100", label: "R$ 70–100 mil", min: 70000, max: 100000 },
  { id: "acima100", label: "Acima de R$ 100 mil", min: 100000, max: Infinity },
];

// 1ª palavra do modelo verboso pro dropdown ("Polo Track 1.0..." → "Polo").
function modeloCurto(m?: string | null): string | null {
  if (!m) return null;
  const w = m.trim().split(/\s+/)[0];
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : null;
}

function uniqSorted(arr: (string | null | undefined)[]): string[] {
  return [...new Set(arr.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export default function VitrinePremiumClient({
  tenant, nomeEmpresa, whatsapp, estoque, logoUrl, vitrineTema, loja,
}: Props) {
  const theme = useMemo(() => resolveTheme(vitrineTema), [vitrineTema]);

  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [ano, setAno] = useState("");
  const [faixa, setFaixa] = useState("");
  const [chipsSel, setChipsSel] = useState<string[]>([]);
  const [selosSel, setSelosSel] = useState<string[]>([]);
  const [ordenar, setOrdenar] = useState<Ordenar>("recentes");
  const [maisFiltros, setMaisFiltros] = useState(false);
  // `null` = ficha aberta pelo menu, sem carro escolhido ainda.
  const [ficha, setFicha] = useState<{ carro: any | null } | null>(null);

  // ── Facets derivados do estoque real ───────────────────────────────────────
  const marcas = useMemo(() => uniqSorted(estoque.map((c) => c.marca)), [estoque]);
  const modelos = useMemo(() => {
    const pool = marca ? estoque.filter((c) => c.marca === marca) : estoque;
    return uniqSorted(pool.map((c) => modeloCurto(c.modelo)));
  }, [estoque, marca]);
  const anos = useMemo(
    () => uniqSorted(estoque.map((c) => c.ano_modelo?.toString())).sort((a, b) => Number(b) - Number(a)),
    [estoque]
  );
  const chips = useMemo(() => chipsDe(estoque), [estoque]);
  const selosDisponiveis = useMemo(() => {
    const seen = new Map<string, string>();
    estoque.forEach((c) => selosDe(c).forEach((s) => seen.set(s.key, s.labelLongo ?? s.label)));
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [estoque]);

  const recemChegados = useMemo(() => estoque.filter((c) => isRecemChegado(c.created_at)), [estoque]);
  const [destaque, ...outrosNovos] = recemChegados;

  // ── Filtro + ordenação ─────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const faixaDef = faixa ? FAIXAS.find((f) => f.id === faixa) : null;
    const chipsAtivos: ChipRapido[] = chips.filter((c) => chipsSel.includes(c.key));

    let r = estoque.filter((c) => {
      if (marca && c.marca !== marca) return false;
      if (modelo && modeloCurto(c.modelo) !== modelo) return false;
      if (ano && String(c.ano_modelo) !== ano) return false;
      if (faixaDef) {
        const p = c.preco_sugerido ?? -1;
        if (p < faixaDef.min || p >= faixaDef.max) return false;
      }
      if (chipsAtivos.length && !chipsAtivos.every((chip) => chip.match(c))) return false;
      if (selosSel.length) {
        const keys = selosDe(c).map((s) => s.key);
        if (!selosSel.every((k) => keys.includes(k))) return false;
      }
      if (q) {
        const hay = `${c.marca ?? ""} ${c.modelo ?? ""} ${c.versao ?? ""} ${c.cor ?? ""} ${c.categoria ?? ""} ${c.ano_modelo ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (ordenar === "preco_asc") r = [...r].sort((a, b) => (a.preco_sugerido ?? Infinity) - (b.preco_sugerido ?? Infinity));
    if (ordenar === "preco_desc") r = [...r].sort((a, b) => (b.preco_sugerido ?? -1) - (a.preco_sugerido ?? -1));
    return r;
  }, [estoque, busca, marca, modelo, ano, faixa, chips, chipsSel, selosSel, ordenar]);

  const temFiltro = !!(busca || marca || modelo || ano || faixa || chipsSel.length || selosSel.length);
  const limpar = () => {
    setBusca(""); setMarca(""); setModelo(""); setAno(""); setFaixa(""); setChipsSel([]); setSelosSel([]);
  };
  const toggle = (set: (fn: (p: string[]) => string[]) => void) => (k: string) =>
    set((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleChip = toggle(setChipsSel);
  const toggleSelo = toggle(setSelosSel);

  const local = localDaLoja(loja);
  const abrirFicha = (carro: any | null) => setFicha({ carro });

  // Painel de filtro do hero fica sobre a capa → superfícies escuras translúcidas.
  const selectHero =
    "w-full appearance-none bg-white/10 border border-white/25 rounded-xl pl-3.5 pr-8 py-3 text-sm font-bold text-white focus:outline-none focus:border-white/70 cursor-pointer [&>option]:text-[var(--fg)]";

  return (
    <div style={themeStyle(theme)} className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans">
      <PremiumTopo
        tenant={tenant}
        nomeEmpresa={nomeEmpresa}
        logoUrl={logoUrl}
        whatsapp={whatsapp}
        loja={loja}
        busca={busca}
        onBusca={setBusca}
        onFinanciar={() => abrirFicha(null)}
      />

      {/* ══ Hero + painel de filtro ══ */}
      <section className="relative overflow-hidden">
        {theme.capaUrl ? (
          <>
            <img src={theme.capaUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(110deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.65) 100%)" }} />
          </>
        ) : (
          <>
            <div className="absolute inset-0" style={{ background: "linear-gradient(120deg, var(--brand) 0%, var(--accent) 100%)" }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/15" />
          </>
        )}

        <div className="relative max-w-7xl mx-auto px-5 py-10 sm:py-16 grid gap-8 lg:grid-cols-2 lg:items-center text-white">
          {/* Chamada */}
          <div>
            <h1 className="font-black uppercase italic tracking-tight leading-[0.95] drop-shadow" style={{ fontSize: "clamp(30px,5.5vw,58px)" }}>
              {nomeEmpresa}
            </h1>
            {local && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-white/85">
                <MapPin size={15} /> {local}
              </p>
            )}
            {theme.tagline && (
              <p className="mt-3 text-base sm:text-lg font-medium text-white/85 max-w-xl">{theme.tagline}</p>
            )}
            <div className="mt-6 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white/12 backdrop-blur-sm rounded-full px-4 py-2 ring-1 ring-white/25">
              <span className="flex items-center gap-1.5 text-[13px] font-black">
                <ShieldCheck size={15} /> {estoque.length} veículo{estoque.length !== 1 ? "s" : ""} disponíve{estoque.length !== 1 ? "is" : "l"}
              </span>
              <span className="hidden sm:inline text-white/40">·</span>
              <span className="hidden sm:flex items-center gap-1.5 text-[12px] font-medium text-white/80">
                <Sparkles size={13} /> Estoque atualizado em tempo real
              </span>
            </div>
          </div>

          {/* Painel de filtro */}
          <div className="bg-black/45 backdrop-blur-md rounded-2xl ring-1 ring-white/20 p-5 shadow-2xl">
            <div className="relative mb-3 md:hidden">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar veículo…"
                className="w-full bg-white/10 border border-white/25 rounded-xl pl-10 pr-4 py-3 text-sm font-semibold text-white placeholder:text-white/50 focus:outline-none focus:border-white/70"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <CampoHero label="Marca" value={marca} placeholder="Todas" cls={selectHero}
                onChange={(v) => { setMarca(v); setModelo(""); }}
                options={marcas.map((m) => ({ value: m, label: m }))} />
              <CampoHero label="Modelo" value={modelo} placeholder="Todos" cls={selectHero}
                onChange={setModelo} disabled={modelos.length === 0}
                options={modelos.map((m) => ({ value: m, label: m }))} />
              <CampoHero label="Faixa de preço" value={faixa} placeholder="Qualquer" cls={selectHero}
                onChange={setFaixa}
                options={FAIXAS.map((f) => ({ value: f.id, label: f.label }))} />
              <CampoHero label="Ano" value={ano} placeholder="Qualquer" cls={selectHero}
                onChange={setAno}
                options={anos.map((a) => ({ value: a, label: a }))} />
            </div>

            {/* Chips rápidos — só os que têm carro no estoque */}
            {chips.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {chips.map((chip) => {
                  const on = chipsSel.includes(chip.key);
                  return (
                    <button
                      key={chip.key}
                      onClick={() => toggleChip(chip.key)}
                      className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                        on ? "bg-white text-[var(--brand)] border-white" : "border-white/30 text-white/85 hover:border-white/70"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-white/15 flex items-center gap-3">
              <a
                href="#estoque"
                className="flex-1 text-center bg-white text-[var(--brand)] py-3 rounded-xl text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                Ver {filtrados.length} veículo{filtrados.length !== 1 ? "s" : ""}
              </a>
              {temFiltro && (
                <button onClick={limpar} className="flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-white/80 hover:text-white">
                  <RotateCcw size={12} /> Limpar
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ══ Recém-chegados ══ */}
      {recemChegados.length > 0 && !temFiltro && (
        <section className="max-w-7xl mx-auto px-5 pt-12">
          <div className="flex items-center gap-2 mb-5">
            <Sparkles size={17} className="text-[var(--brand)]" />
            <h2 className="text-[15px] font-black uppercase tracking-widest">Recém-chegados</h2>
            <span className="text-[11px] font-bold text-[var(--fg-faint)]">esta semana</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            {/* Semana com UM carro novo só: o destaque vira faixa larga. Sem isso
                sobrava meia linha vazia do lado — o caso mais comum no estoque real. */}
            <div className={outrosNovos.length > 0 ? "lg:col-span-5" : "lg:col-span-12"}>
              <CardDestaque
                c={destaque} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp}
                onFinanciar={abrirFicha} largo={outrosNovos.length === 0}
              />
            </div>
            {outrosNovos.length > 0 && (
              <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-4 content-start">
                {outrosNovos.slice(0, 3).map((c) => (
                  <CarCardPremium key={c.id} c={c} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp} onFinanciar={abrirFicha} novo />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══ Estoque ══ */}
      <section id="estoque" className="scroll-mt-32 max-w-7xl mx-auto px-5 py-12">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-black uppercase tracking-widest">Nosso estoque</h2>
            <span className="text-[12px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
              <span className="text-[var(--brand)]">{filtrados.length}</span> {filtrados.length === 1 ? "veículo" : "veículos"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {selosDisponiveis.length > 0 && (
              <button
                onClick={() => setMaisFiltros((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--brand)] transition-colors"
              >
                <SlidersHorizontal size={13} /> Selos
                {selosSel.length > 0 && (
                  <span className="ml-1 min-w-4 h-4 px-1 rounded-full bg-[var(--brand)] text-[var(--brand-fg)] text-[9px] flex items-center justify-center">
                    {selosSel.length}
                  </span>
                )}
                <ChevronDown size={13} className={`transition-transform ${maisFiltros ? "rotate-180" : ""}`} />
              </button>
            )}
            <div className="relative">
              <select
                value={ordenar}
                onChange={(e) => setOrdenar(e.target.value as Ordenar)}
                className="appearance-none bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl pl-3.5 pr-8 py-2 text-[13px] font-bold text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] cursor-pointer"
              >
                <option value="recentes">Mais recentes</option>
                <option value="preco_asc">Menor preço</option>
                <option value="preco_desc">Maior preço</option>
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
            </div>
          </div>
        </div>

        {maisFiltros && selosDisponiveis.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {selosDisponiveis.map((s) => {
              const on = selosSel.includes(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => toggleSelo(s.key)}
                  className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                    on
                      ? "bg-[var(--brand)] border-[var(--brand)] text-[var(--brand-fg)]"
                      : "border-[var(--border-strong)] text-[var(--fg-muted)] hover:border-[var(--brand)]"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        {filtrados.length > 0 ? (
          <div className="grid gap-4 sm:gap-5 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtrados.map((c) => (
              <CarCardPremium
                key={c.id} c={c} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp}
                onFinanciar={abrirFicha} novo={isRecemChegado(c.created_at)}
              />
            ))}
          </div>
        ) : (
          <div className="py-28 text-center border-2 border-dashed border-[var(--border-strong)] rounded-3xl bg-[var(--surface)]">
            <Car size={32} className="mx-auto text-[var(--fg-faint)] mb-4" />
            <p className="text-xs font-black uppercase tracking-widest text-[var(--fg-muted)]">
              {temFiltro ? "Nenhum veículo com esses filtros" : "Pátio sendo reabastecido…"}
            </p>
            {temFiltro && (
              <button onClick={limpar} className="mt-4 text-[11px] font-black uppercase tracking-widest text-[var(--brand)] hover:opacity-70">
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </section>

      <PremiumRodape nomeEmpresa={nomeEmpresa} loja={loja} sobre={theme.sobre} whatsapp={whatsapp} />
      <PremiumFab whatsapp={whatsapp} nomeEmpresa={nomeEmpresa} />

      {ficha && (
        <FichaFinanciamento
          tenant={tenant}
          veiculo={ficha.carro ?? {}}
          whatsapp={whatsapp}
          nomeEmpresa={nomeEmpresa}
          onClose={() => setFicha(null)}
        />
      )}
    </div>
  );
}

function CampoHero({
  label, value, placeholder, onChange, options, disabled, cls,
}: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean; cls: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-widest text-white/70 mb-1.5 px-1">{label}</label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cls}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
      </div>
    </div>
  );
}
