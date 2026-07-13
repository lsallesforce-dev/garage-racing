"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, MessageCircle, Play, ChevronDown, X, SlidersHorizontal,
  Car, MapPin, Gauge, Fuel, Cog, Clock, Phone, ShieldCheck, Sparkles, RotateCcw,
} from "lucide-react";
import {
  resolveTheme, themeStyle, fmtBRL, fmtKm, whatsappLink, isRecemChegado, selosDe,
  type VitrineTema,
} from "../theme";

interface Loja {
  cidade: string | null;
  estado: string | null;
  endereco: string | null;
  enderecoComplemento: string | null;
  horario: string | null;
  telefone: string | null;
}

interface Props {
  tenant: string;
  nomeEmpresa: string;
  whatsapp: string;
  estoque: any[];
  logoUrl?: string | null;
  vitrineTema?: VitrineTema | null;
  loja: Loja;
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

export default function VitrineClient({
  tenant, nomeEmpresa, whatsapp, estoque, logoUrl, vitrineTema, loja,
}: Props) {
  const theme = useMemo(() => resolveTheme(vitrineTema), [vitrineTema]);

  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [ano, setAno] = useState("");
  const [faixa, setFaixa] = useState("");
  const [ordenar, setOrdenar] = useState<Ordenar>("recentes");
  const [selosSel, setSelosSel] = useState<string[]>([]);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [modalCarro, setModalCarro] = useState<any | null>(null);

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
  const selosDisponiveis = useMemo(() => {
    const seen = new Map<string, string>();
    estoque.forEach((c) => selosDe(c).forEach((s) => seen.set(s.key, s.label)));
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [estoque]);

  const recemChegados = useMemo(
    () => estoque.filter((c) => isRecemChegado(c.created_at)),
    [estoque]
  );

  // ── Filtro + ordenação ─────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const faixaDef = faixa ? FAIXAS.find((f) => f.id === faixa) : null;
    let r = estoque.filter((c) => {
      if (marca && c.marca !== marca) return false;
      if (modelo && modeloCurto(c.modelo) !== modelo) return false;
      if (ano && String(c.ano_modelo) !== ano) return false;
      if (faixaDef) {
        const p = c.preco_sugerido ?? -1;
        if (p < faixaDef.min || p >= faixaDef.max) return false;
      }
      if (selosSel.length) {
        const keys = selosDe(c).map((s) => s.key);
        if (!selosSel.every((k) => keys.includes(k))) return false;
      }
      if (q) {
        const hay = `${c.marca ?? ""} ${c.modelo ?? ""} ${c.versao ?? ""} ${c.cor ?? ""} ${c.categoria ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (ordenar === "preco_asc") r = [...r].sort((a, b) => (a.preco_sugerido ?? Infinity) - (b.preco_sugerido ?? Infinity));
    if (ordenar === "preco_desc") r = [...r].sort((a, b) => (b.preco_sugerido ?? -1) - (a.preco_sugerido ?? -1));
    return r;
  }, [estoque, busca, marca, modelo, ano, faixa, selosSel, ordenar]);

  const temFiltro = !!(busca || marca || modelo || ano || faixa || selosSel.length);
  const limpar = () => {
    setBusca(""); setMarca(""); setModelo(""); setAno(""); setFaixa(""); setSelosSel([]);
  };
  const toggleSelo = (k: string) =>
    setSelosSel((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const localLoja = [loja.cidade, loja.estado].filter(Boolean).join(" - ");
  const heroTagline = theme.tagline;

  // classes reutilizáveis (via CSS vars da marca/neutros)
  const cardCls =
    "bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col";
  const selectCls =
    "w-full appearance-none bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-xl pl-3.5 pr-8 py-2.5 text-sm font-bold text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] cursor-pointer";

  return (
    <div style={themeStyle(theme)} className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans">
      <style>{`@keyframes vfade{from{opacity:0}to{opacity:1}}`}</style>

      {/* ══ Header ══ */}
      <header className="sticky top-0 z-40 bg-[var(--surface)]/90 backdrop-blur border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between gap-3">
          <Link href={`/vitrine/${tenant}`} className="flex items-center gap-2.5 min-w-0">
            {logoUrl ? (
              <img src={logoUrl} alt={nomeEmpresa} className="h-9 w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="text-lg font-black uppercase italic tracking-tighter truncate">{nomeEmpresa}</span>
            )}
          </Link>
          <a
            href={whatsappLink(whatsapp, `Olá! Vim pela vitrine da ${nomeEmpresa} e preciso de ajuda para escolher um veículo.`)}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest transition-colors whitespace-nowrap"
          >
            <MessageCircle size={14} /> <span className="hidden sm:inline">Falar com </span>consultor
          </a>
        </div>
      </header>

      {/* ══ Hero da loja ══ */}
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        {/* Fundo: capa (com overlay) ou gradiente da marca */}
        {theme.capaUrl ? (
          <>
            <img src={theme.capaUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.72) 100%)" }} />
          </>
        ) : (
          <>
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)` }} />
            {/* scrim garante legibilidade do texto branco em marcas claras */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-black/10" />
          </>
        )}

        <div className="relative max-w-7xl mx-auto px-5 py-9 sm:py-16 text-white">
          {logoUrl && (
            <div className="inline-flex items-center bg-white rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-lg mb-4 sm:mb-5">
              <img src={logoUrl} alt={nomeEmpresa} className="h-9 sm:h-12 w-auto max-w-[180px] sm:max-w-[220px] object-contain" />
            </div>
          )}
          <h1 className="font-black uppercase italic tracking-tight leading-[0.95]" style={{ fontSize: "clamp(28px,5.5vw,56px)" }}>
            {nomeEmpresa}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {localLoja && (
              <span className="flex items-center gap-1.5 text-sm font-bold text-white/85">
                <MapPin size={15} /> {localLoja}
              </span>
            )}
            {heroTagline && (
              <span className="text-sm font-medium text-white/80 max-w-xl">{heroTagline}</span>
            )}
          </div>

          {/* Banner de confiança */}
          <div className="mt-6 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white/12 backdrop-blur-sm rounded-full px-4 py-2 ring-1 ring-white/25">
            <span className="flex items-center gap-1.5 text-[13px] font-black">
              <ShieldCheck size={15} /> {estoque.length} carro{estoque.length !== 1 ? "s" : ""} disponíve{estoque.length !== 1 ? "is" : "l"} agora
            </span>
            <span className="hidden sm:inline text-white/40">·</span>
            <span className="hidden sm:flex items-center gap-1.5 text-[12px] font-medium text-white/80">
              <Sparkles size={13} /> Estoque atualizado em tempo real
            </span>
          </div>
        </div>
      </section>

      {/* ══ Barra de filtros (card flutuante) ══ */}
      <div className="relative z-20 max-w-7xl mx-auto px-5 -mt-7">
        <div className="bg-[var(--surface)] rounded-2xl shadow-xl border border-[var(--border)] p-4 sm:p-5">
          {/* Busca livre */}
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por marca, modelo, cor…"
              className="w-full bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-xl pl-10 pr-4 py-2.5 text-sm font-semibold text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-[var(--brand)]"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FieldSelect label="Marca" value={marca} placeholder="Todas" cls={selectCls}
              onChange={(v) => { setMarca(v); setModelo(""); }}
              options={marcas.map((m) => ({ value: m, label: m }))} />
            <FieldSelect label="Modelo" value={modelo} placeholder="Todos" cls={selectCls}
              onChange={setModelo} disabled={modelos.length === 0}
              options={modelos.map((m) => ({ value: m, label: m }))} />
            <FieldSelect label="Faixa de preço" value={faixa} placeholder="Qualquer" cls={selectCls}
              onChange={setFaixa}
              options={FAIXAS.map((f) => ({ value: f.id, label: f.label }))} />
            <FieldSelect label="Ano" value={ano} placeholder="Qualquer" cls={selectCls}
              onChange={setAno}
              options={anos.map((a) => ({ value: a, label: a }))} />
          </div>

          {/* Linha de ações + mais filtros */}
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-2">
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
            {temFiltro && (
              <button onClick={limpar} className="ml-auto flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-[var(--brand)] hover:opacity-70">
                <RotateCcw size={12} /> Limpar
              </button>
            )}
          </div>

          {maisFiltros && selosDisponiveis.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selosDisponiveis.map((s) => {
                const on = selosSel.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleSelo(s.key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
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
        </div>
      </div>

      {/* ══ Recém-chegados ══ */}
      {recemChegados.length > 0 && !temFiltro && (
        <section className="max-w-7xl mx-auto px-5 pt-10">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-[var(--brand)]" />
            <h2 className="text-[13px] font-black uppercase tracking-widest">Recém-chegados</h2>
            <span className="text-[11px] font-bold text-[var(--fg-faint)]">esta semana</span>
          </div>
          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 -mx-5 px-5 snap-x">
            {recemChegados.map((c) => (
              <div key={c.id} className="snap-start shrink-0 w-[200px] sm:w-[250px]">
                <CarCard c={c} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp} onSimular={setModalCarro} cardCls={cardCls} novo />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══ Grid ══ */}
      <section className="max-w-7xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between gap-3 mb-6">
          <p className="text-[12px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
            <span className="text-[var(--brand)]">{filtrados.length}</span>{" "}
            {filtrados.length === 1 ? "veículo" : "veículos"}
          </p>
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
          <div className="grid gap-3 sm:gap-5 grid-cols-2 lg:grid-cols-3">
            {filtrados.map((c) => (
              <CarCard key={c.id} c={c} tenant={tenant} nomeEmpresa={nomeEmpresa} whatsapp={whatsapp} onSimular={setModalCarro} cardCls={cardCls} novo={isRecemChegado(c.created_at)} />
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

      {/* ══ Sobre a loja ══ */}
      {(theme.sobre || loja.endereco || loja.horario || loja.telefone || localLoja) && (
        <section className="border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="max-w-7xl mx-auto px-5 py-12 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-3">Sobre a loja</p>
              <h3 className="text-2xl font-black uppercase italic tracking-tight mb-3">{nomeEmpresa}</h3>
              {theme.sobre && <p className="text-sm text-[var(--fg-muted)] leading-relaxed whitespace-pre-line max-w-prose">{theme.sobre}</p>}
            </div>
            <div className="space-y-3">
              {(loja.endereco || localLoja) && (
                <InfoRow icon={<MapPin size={16} />}>
                  {[loja.endereco, loja.enderecoComplemento, localLoja].filter(Boolean).join(", ")}
                </InfoRow>
              )}
              {loja.horario && <InfoRow icon={<Clock size={16} />}>{loja.horario}</InfoRow>}
              {loja.telefone && <InfoRow icon={<Phone size={16} />}>{loja.telefone}</InfoRow>}
              <a
                href={whatsappLink(whatsapp, `Olá! Vim pela vitrine da ${nomeEmpresa} e quero mais informações.`)}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-xl text-[12px] font-black uppercase tracking-widest transition-colors"
              >
                <MessageCircle size={15} /> Chamar no WhatsApp
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ══ Footer ══ */}
      <footer className="border-t border-[var(--border)] py-8 text-center bg-[var(--bg)]">
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--fg-faint)]">
          © {new Date().getFullYear()} {nomeEmpresa} · Vitrine digital
        </p>
      </footer>

      {/* ══ FAB WhatsApp ══ */}
      <a
        href={whatsappLink(whatsapp, `Olá! Vim pela vitrine da ${nomeEmpresa} e preciso de ajuda para escolher um veículo.`)}
        target="_blank" rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white pl-4 pr-5 py-3.5 rounded-full shadow-2xl transition-all hover:scale-105 active:scale-95"
      >
        <MessageCircle size={18} strokeWidth={2.5} />
        <span className="font-black uppercase text-[10px] tracking-widest">Falar agora</span>
      </a>

      {modalCarro && (
        <ModalFinanciamento carro={modalCarro} whatsapp={whatsapp} nomeEmpresa={nomeEmpresa} onClose={() => setModalCarro(null)} />
      )}
    </div>
  );
}

// ─── Card do veículo ──────────────────────────────────────────────────────────
function CarCard({
  c, tenant, nomeEmpresa, whatsapp, onSimular, cardCls, novo,
}: {
  c: any; tenant: string; nomeEmpresa: string; whatsapp: string;
  onSimular: (c: any) => void; cardCls: string; novo?: boolean;
}) {
  const img = c.capa_marketing_url ?? c.fotos?.[0];
  const titulo = [c.marca, c.modelo].filter(Boolean).join(" ") || "Veículo";
  const selos = selosDe(c);
  const href = `/vitrine/${tenant}/${c.id}`;
  const msg = `Olá! Vi o *${titulo}${c.ano_modelo ? " " + c.ano_modelo : ""}* na vitrine da ${nomeEmpresa} e tenho interesse. Ainda está disponível?`;

  return (
    <article className={cardCls}>
      <Link href={href} className="relative block aspect-[4/3] bg-[var(--surface-2)] overflow-hidden group">
        {img ? (
          <>
            <img src={img} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70" />
            <img src={img} alt={titulo} loading="lazy" className="absolute inset-0 w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--fg-faint)]"><Car size={30} /></div>
        )}
        {/* topo-esq: novo + vídeo */}
        <div className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
          {novo && (
            <span className="flex items-center gap-1 bg-[var(--brand)] text-[var(--brand-fg)] px-2 sm:px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow">
              <Sparkles size={9} /> <span className="sm:hidden">Novo</span><span className="hidden sm:inline">Chegou essa semana</span>
            </span>
          )}
          {c.video_url && (
            <span className="flex items-center gap-1 bg-black/75 text-white px-2 sm:px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow backdrop-blur-sm">
              <Play size={8} className="fill-white" /> Vídeo
            </span>
          )}
        </div>
        {/* base: selos */}
        {selos.length > 0 && (
          <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1 max-w-[88%]">
            {selos.map((s) => (
              <span key={s.key} className={`${s.className} px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest`}>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </Link>

      <div className="p-3 sm:p-4 flex flex-col flex-1">
        <Link href={href} className="min-w-0 block">
          <h3 className="text-[13px] sm:text-[15px] font-black uppercase italic tracking-tight leading-tight truncate hover:text-[var(--brand)] transition-colors">{titulo}</h3>
          <p className="text-[9px] sm:text-[10px] text-[var(--fg-faint)] font-bold uppercase tracking-widest mt-1 truncate">
            {[c.versao, c.ano_modelo].filter(Boolean).join(" • ") || "—"}
          </p>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2 text-[10px] sm:text-[11px] text-[var(--fg-muted)] font-semibold">
            {fmtKm(c.quilometragem_estimada) && <span className="flex items-center gap-1"><Gauge size={11} /> {fmtKm(c.quilometragem_estimada)}</span>}
            {c.combustivel && <span className="hidden sm:flex items-center gap-1"><Fuel size={11} /> {c.combustivel}</span>}
            {c.cambio && <span className="hidden sm:flex items-center gap-1"><Cog size={11} /> {c.cambio}</span>}
          </div>

          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <p className="text-[8px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-0.5">Preço</p>
            <p className="text-lg sm:text-2xl font-black tracking-tighter text-[var(--fg)]">{fmtBRL(c.preco_sugerido)}</p>
          </div>
        </Link>

        <div className="mt-3 flex flex-col flex-1 justify-end gap-2">
          <a
            href={whatsappLink(whatsapp, msg)}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-xl font-black uppercase text-[9px] tracking-widest transition-colors"
          >
            <MessageCircle size={11} /> WhatsApp
          </a>
          <button
            onClick={() => onSimular(c)}
            className="text-[9px] font-black uppercase tracking-widest text-[var(--fg-faint)] hover:text-[var(--brand)] transition-colors w-full text-center"
          >
            Simular financiamento
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────
function FieldSelect({
  label, value, placeholder, onChange, options, disabled, cls,
}: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean; cls: string;
}) {
  return (
    <div>
      <label className="block text-[9px] font-black uppercase tracking-widest text-[var(--fg-faint)] mb-1.5 px-1">{label}</label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cls}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
      </div>
    </div>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm text-[var(--fg-muted)]">
      <span className="text-[var(--brand)] mt-0.5 shrink-0">{icon}</span>
      <span className="leading-snug">{children}</span>
    </div>
  );
}

// ─── Modal de financiamento ───────────────────────────────────────────────────
function ModalFinanciamento({
  carro, whatsapp, nomeEmpresa, onClose,
}: { carro: any; whatsapp: string; nomeEmpresa: string; onClose: () => void }) {
  const preco = carro.preco_sugerido ?? 0;
  const [entrada, setEntrada] = useState("");
  const [parcelas, setParcelas] = useState("48");
  const [nome, setNome] = useState("");
  const entradaNum = parseFloat(entrada.replace(/\./g, "").replace(",", ".")) || 0;
  const saldo = Math.max(preco - entradaNum, 0);
  const valorParcela = saldo / (parseInt(parcelas) || 1);

  const msg =
    `Olá! Vi o *${carro.marca} ${carro.modelo}${carro.ano_modelo ? " " + carro.ano_modelo : ""}* na vitrine da ${nomeEmpresa} e gostaria de uma simulação real.\n\n` +
    `💰 Valor: ${fmtBRL(preco)}\n` +
    (entradaNum > 0 ? `💵 Entrada: ${fmtBRL(entradaNum)}\n` : "") +
    `📅 Prazo: ${parcelas}x` +
    (saldo > 0 ? ` (~${fmtBRL(valorParcela)}/mês s/ juros)\n` : "\n") +
    (nome ? `👤 ${nome}\n` : "") +
    `\nPode me passar as melhores condições?`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div style={{ colorScheme: "light" }} className="bg-white text-gray-900 rounded-3xl w-full max-w-md p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-5">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Simulação de financiamento</p>
            <h3 className="text-lg font-black uppercase italic tracking-tight">{carro.marca} {carro.modelo}</h3>
            <p className="text-sm font-black tracking-tighter text-[var(--brand)] mt-1">{fmtBRL(preco)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full grid place-items-center hover:bg-gray-200 transition"><X size={14} /></button>
        </div>

        <div className="space-y-4 mb-5">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Seu nome</label>
            <input type="text" placeholder="Ex: João Silva" value={nome} onChange={(e) => setNome(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-[var(--brand)]" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Valor de entrada (R$)</label>
            <input type="number" placeholder="Ex: 15000" value={entrada} onChange={(e) => setEntrada(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-[var(--brand)]" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Prazo</label>
            <div className="grid grid-cols-6 gap-1.5">
              {[12, 24, 36, 48, 60, 72].map((n) => (
                <button key={n} onClick={() => setParcelas(String(n))}
                  className={`py-2 rounded-lg text-[11px] font-black transition ${parcelas === String(n) ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                  {n}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {saldo > 0 && (
          <div className="bg-gray-50 rounded-2xl p-4 mb-5">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Estimativa de parcela</p>
            <p className="text-3xl font-black tracking-tighter text-[var(--brand)]">{fmtBRL(valorParcela)}<span className="text-sm font-bold text-gray-400"> /mês</span></p>
            <p className="text-[9px] text-gray-400 mt-1">Simulação sem juros. Taxa final sujeita à análise de crédito.</p>
          </div>
        )}

        <a href={whatsappLink(whatsapp, msg)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition active:scale-[0.98]">
          <MessageCircle size={16} /> Solicitar simulação real
        </a>
      </div>
    </div>
  );
}
