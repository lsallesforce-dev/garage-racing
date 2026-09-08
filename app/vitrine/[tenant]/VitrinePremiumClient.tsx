"use client";

// Layout PREMIUM da vitrine — home.
//
// Escolhido em `page.tsx` quando `vitrine_tema.layout === "premium"` (hoje só a
// APROVE Multimarcas, migration 054). O layout padrão continua em
// `VitrineClient.tsx`, INTOCADO — é a garantia mecânica de que Carmatti e as
// demos não quebram por causa desta tela.
//
// Ordem da página: banner → barra de filtro flutuante → 3 últimos que chegaram →
// estoque completo. Os facets saem do estoque real: marca/modelo/ano/chip que
// não tem carro não aparece na tela.

import { useMemo, useState } from "react";
import {
  ChevronDown, SlidersHorizontal, RotateCcw, Car, Search, X,
  Sparkles, ShieldCheck, MapPin,
} from "lucide-react";
import {
  resolveTheme, themeStyle, isRecemChegado, selosDe, chipsDe, partesHeadline,
  type VitrineTema, type ChipRapido,
} from "../theme";
import FichaFinanciamento from "@/components/vitrine/FichaFinanciamento";
import { PremiumTopo, PremiumRodape, PremiumFab, localDaLoja, type LojaPremium } from "@/components/vitrine/premium/Chrome";
import { CarCardPremium } from "@/components/vitrine/premium/CarCardPremium";

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
  const [buscaAberta, setBuscaAberta] = useState(false);
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

  // "Os 3 últimos que chegaram": o estoque já vem ordenado por created_at desc do
  // servidor. É sempre 3 — diferente do selo "recém-chegado", que só sai no carro
  // cadastrado nos últimos 7 dias e por isso pode não existir em nenhum.
  const ultimosChegados = useMemo(() => estoque.slice(0, 3), [estoque]);

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

  const selectCls =
    "w-full appearance-none bg-transparent border-0 border-b border-[var(--border-strong)] pl-0 pr-6 py-1.5 text-[15px] font-semibold text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] cursor-pointer";

  return (
    <div style={themeStyle(theme)} className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans">
      <PremiumTopo
        tenant={tenant}
        nomeEmpresa={nomeEmpresa}
        logoUrl={logoUrl}
        whatsapp={whatsapp}
        loja={loja}
        onFinanciar={() => setFicha({ carro: null })}
      />

      {/* ══ Banner ══ */}
      {/* pb-16: a barra de filtro flutua encavalando a base do banner. */}
      <section className="relative overflow-hidden pb-16">
        {theme.capaUrl ? (
          <>
            <img src={theme.capaUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.25) 100%)" }} />
          </>
        ) : (
          <>
            <div className="absolute inset-0" style={{ background: "linear-gradient(120deg, var(--brand-dark) 0%, var(--brand) 55%, var(--accent) 100%)" }} />
            <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
          </>
        )}

        <div className="relative max-w-7xl mx-auto px-5 pt-14 sm:pt-20 pb-6 text-white">
          <div className="max-w-2xl">
            {theme.headline ? (
              <h1 className="font-black uppercase italic tracking-tight leading-[0.95] drop-shadow-lg" style={{ fontSize: "clamp(30px,5.2vw,56px)" }}>
                {partesHeadline(theme.headline).map((p, i) =>
                  p.destaque ? (
                    <span key={i} style={{ color: "var(--accent)" }}>{p.txt}</span>
                  ) : (
                    <span key={i}>{p.txt}</span>
                  )
                )}
              </h1>
            ) : (
              // Sem copy de campanha configurada, o banner mostra a loja — nunca
              // um texto de marketing inventado pelo código.
              <h1 className="font-black uppercase italic tracking-tight leading-[0.95] drop-shadow-lg" style={{ fontSize: "clamp(30px,5.2vw,56px)" }}>
                {nomeEmpresa}
              </h1>
            )}

            {(theme.subtitulo || theme.tagline) && (
              <p className="mt-4 text-lg sm:text-2xl font-bold text-white/90 drop-shadow">
                {theme.subtitulo ?? theme.tagline}
              </p>
            )}

            {local && (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-white/75">
                <MapPin size={15} /> {local}
              </p>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <a
                href="#estoque"
                className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-7 py-4 rounded-full text-[12px] font-black uppercase tracking-widest transition-colors shadow-lg"
              >
                {theme.ctaLabel ?? "Conheça o estoque"}
              </a>
              <span className="flex items-center gap-1.5 text-[13px] font-black text-white/85">
                <ShieldCheck size={15} /> {estoque.length} veículo{estoque.length !== 1 ? "s" : ""} disponíve{estoque.length !== 1 ? "is" : "l"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Barra de filtro flutuante ══ */}
      <div className="relative z-20 max-w-5xl mx-auto px-5 -mt-11">
        <div className="bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--border)] px-5 py-4">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
            <CampoFiltro label="Marca" value={marca} placeholder="Todas" cls={selectCls}
              onChange={(v) => { setMarca(v); setModelo(""); }}
              options={marcas.map((m) => ({ value: m, label: m }))} />
            <CampoFiltro label="Modelo" value={modelo} placeholder="Todos" cls={selectCls}
              onChange={setModelo} disabled={modelos.length === 0}
              options={modelos.map((m) => ({ value: m, label: m }))} />
            <CampoFiltro label="Faixa de preço" value={faixa} placeholder="Qualquer" cls={selectCls}
              onChange={setFaixa}
              options={FAIXAS.map((f) => ({ value: f.id, label: f.label }))} />
            <CampoFiltro label="Ano" value={ano} placeholder="Qualquer" cls={selectCls}
              onChange={setAno}
              options={anos.map((a) => ({ value: a, label: a }))} />

            <div className="flex items-center gap-3 ml-auto pb-1">
              <button
                onClick={() => setMaisFiltros((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--brand)] transition-colors whitespace-nowrap"
              >
                <SlidersHorizontal size={13} /> Mais filtros
                {(chipsSel.length + selosSel.length) > 0 && (
                  <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--brand)] text-[var(--brand-fg)] text-[9px] flex items-center justify-center">
                    {chipsSel.length + selosSel.length}
                  </span>
                )}
                <ChevronDown size={13} className={`transition-transform ${maisFiltros ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => setBuscaAberta((v) => !v)}
                aria-label="Buscar por texto"
                className={`w-10 h-10 rounded-full grid place-items-center transition-colors ${
                  buscaAberta || busca ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--brand)]"
                }`}
              >
                {buscaAberta ? <X size={17} /> : <Search size={17} />}
              </button>
            </div>
          </div>

          {buscaAberta && (
            <div className="relative mt-4">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por marca, modelo, versão, cor…"
                className="w-full bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-xl pl-10 pr-4 py-2.5 text-sm font-semibold text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-[var(--brand)]"
              />
            </div>
          )}

          {maisFiltros && (
            <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-2">
              {chips.map((chip) => (
                <BotaoFiltro key={chip.key} on={chipsSel.includes(chip.key)} onClick={() => toggleChip(chip.key)}>
                  {chip.label}
                </BotaoFiltro>
              ))}
              {selosDisponiveis.map((s) => (
                <BotaoFiltro key={s.key} on={selosSel.includes(s.key)} onClick={() => toggleSelo(s.key)}>
                  {s.label}
                </BotaoFiltro>
              ))}
              {chips.length === 0 && selosDisponiveis.length === 0 && (
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                  Sem filtros extras para este estoque
                </p>
              )}
            </div>
          )}

          {temFiltro && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
                <span className="text-[var(--brand)]">{filtrados.length}</span> {filtrados.length === 1 ? "resultado" : "resultados"}
              </span>
              <button onClick={limpar} className="flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-[var(--brand)] hover:opacity-70">
                <RotateCcw size={12} /> Limpar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ══ Últimos que chegaram ══ */}
      {ultimosChegados.length > 0 && !temFiltro && (
        <section className="max-w-7xl mx-auto px-5 pt-12">
          <div className="flex items-center gap-2 mb-5">
            <Sparkles size={17} className="text-[var(--brand)]" />
            <h2 className="text-[15px] font-black uppercase tracking-widest">Últimos que chegaram</h2>
          </div>
          <div className="grid gap-4 sm:gap-5 grid-cols-2 lg:grid-cols-3">
            {ultimosChegados.map((c) => (
              <CarCardPremium
                key={c.id} c={c} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp}
                novo={isRecemChegado(c.created_at)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ══ Estoque ══ */}
      <section id="estoque" className="scroll-mt-28 max-w-7xl mx-auto px-5 py-12">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-black uppercase tracking-widest">Nosso estoque</h2>
            <span className="text-[12px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
              <span className="text-[var(--brand)]">{filtrados.length}</span> {filtrados.length === 1 ? "veículo" : "veículos"}
            </span>
          </div>

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

        {filtrados.length > 0 ? (
          <div className="grid gap-4 sm:gap-5 grid-cols-2 lg:grid-cols-3">
            {filtrados.map((c) => (
              <CarCardPremium
                key={c.id} c={c} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp}
                novo={isRecemChegado(c.created_at)}
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

function CampoFiltro({
  label, value, placeholder, onChange, options, disabled, cls,
}: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean; cls: string;
}) {
  return (
    <div className="flex-1 min-w-[130px]">
      <label className="block text-[9px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-1">{label}</label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cls}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-1 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
      </div>
    </div>
  );
}

function BotaoFiltro({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
        on
          ? "bg-[var(--brand)] border-[var(--brand)] text-[var(--brand-fg)]"
          : "border-[var(--border-strong)] text-[var(--fg-muted)] hover:border-[var(--brand)]"
      }`}
    >
      {children}
    </button>
  );
}
