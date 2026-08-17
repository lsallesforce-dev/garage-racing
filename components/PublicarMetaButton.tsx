"use client";

// Painel de anúncio Meta para um veículo.
//
// Renda estimada NÃO existe aqui de propósito: a segmentação por renda da Meta
// é calculada por faixa de CEP dos EUA e não é oferecida no Brasil. O bloco que
// existia prometia "em breve" algo que não vai chegar. No lugar entrou busca ao
// vivo de interesses — que é o proxy de poder aquisitivo que funciona no BR, e
// de quebra resolve o bug dos IDs fixos que envelheciam e derrubavam o adset.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2, CheckCircle2, AlertCircle, Facebook, Instagram, X, ChevronDown,
  MapPin, Zap, Search, Users, Target, Wallet, CalendarClock, Play, Pause,
  Trash2, Pencil, MessageCircle, FileText, Info,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Pagina {
  id: string;
  page_id: string;
  page_name: string;
  ad_account_id: string | null;
  instagram_actor_id: string | null;
}

interface Campanha {
  id: string;
  status: string;
  placement: string;
  orcamento_diario: number;
  duracao_dias: number;
  leads_gerados: number;
  gasto_total: number;
  impressoes?: number;
  created_at: string;
  encerra_em: string | null;
  objetivo?: string;
  tipo_orcamento?: string;
  orcamento_total?: number | null;
}

interface Interesse {
  id: string;
  nome: string;
  alcance?: number | null;
  caminho?: string | null;
}

interface Regiao { key: string; nome: string }

interface CidadeResult {
  key: string | null;
  nome: string;
  estado: string;
  source: "meta" | "ibge";
}

interface Props {
  veiculoId: string;
  marca?: string;
  modelo?: string;
  ano?: string | number;
  fotoUrl?: string | null;
  defaultOpen?: boolean;
  onClose?: () => void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ORCAMENTOS = [10, 20, 30, 50, 100];
const ORCAMENTO_RECOMENDADO = 30;
const ORCAMENTO_MINIMO = 6;           // piso da Meta por ad set
const DURACOES = [7, 14, 21, 30];
// Teto real do custom_locations fora dos EUA. Acima disso a Meta recusa o adset
// — o caminho pra alcançar mais longe é estado inteiro, não raio maior.
const RAIO_MAX = 70;
const RAIO_PRESETS = [15, 30, 50, RAIO_MAX];

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtNum = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000) return `${Math.round(v / 1000)}mil`;
  return String(v);
};

function Secao({ icone, titulo, children, dica }: {
  icone: React.ReactNode; titulo: string; children: React.ReactNode; dica?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-gray-400">{icone}</span>
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{titulo}</p>
      </div>
      {children}
      {dica && <p className="text-[9px] text-gray-300 mt-1.5 leading-snug">{dica}</p>}
    </div>
  );
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function PublicarMetaButton({ veiculoId, marca, modelo, ano, fotoUrl, defaultOpen = false, onClose }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const handleClose = () => { setOpen(false); onClose?.(); };

  const [paginas, setPaginas]           = useState<Pagina[]>([]);
  const [campanhas, setCampanhas]       = useState<Campanha[]>([]);
  const [loading, setLoading]           = useState(false);
  const [publicando, setPublicando]     = useState(false);
  const [erro, setErro]                 = useState<string | null>(null);
  const [erroToken, setErroToken]       = useState(false);
  const [sucesso, setSucesso]           = useState(false);

  // Configuração
  const [paginaId, setPaginaId]   = useState("");
  const [objetivo, setObjetivo]   = useState<"leads" | "whatsapp">("leads");
  const [placement, setPlacement] = useState<"facebook" | "instagram" | "facebook,instagram">("facebook,instagram");

  // Orçamento e prazo
  const [tipoOrcamento, setTipoOrcamento] = useState<"diario" | "total">("diario");
  const [orcamento, setOrcamento]         = useState(ORCAMENTO_RECOMENDADO);
  const [orcamentoTotal, setOrcamentoTotal] = useState(210);
  const [duracao, setDuracao]             = useState(7);
  const [semDataFim, setSemDataFim]       = useState(false);
  const [iniciaEm, setIniciaEm]           = useState("");

  // Localização
  const [cidade, setCidade]               = useState("");
  const [raio, setRaio]                   = useState(30);
  const [cidadesExtras, setCidadesExtras] = useState<CidadeResult[]>([]);
  const [regioes, setRegioes]             = useState<Regiao[]>([]);
  const [regioesDisponiveis, setRegioesDisponiveis] = useState<Regiao[]>([]);
  const [modoAlcance, setModoAlcance]     = useState<"raio" | "estado">("raio");

  const [buscaPrincipal, setBuscaPrincipal]               = useState("");
  const [resultadosPrincipal, setResultadosPrincipal]     = useState<CidadeResult[]>([]);
  const [loadingPrincipal, setLoadingPrincipal]           = useState(false);
  const [showDropdownPrincipal, setShowDropdownPrincipal] = useState(false);
  const [buscaCidade, setBuscaCidade]                     = useState("");
  const [resultadosCidades, setResultadosCidades]         = useState<CidadeResult[]>([]);
  const [loadingCidades, setLoadingCidades]               = useState(false);
  const [showDropdown, setShowDropdown]                   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Público
  const [idadeMin, setIdadeMin]   = useState(25);
  const [idadeMax, setIdadeMax]   = useState(55);
  const [genero, setGenero]       = useState<"todos" | "masculino" | "feminino">("todos");
  const [interesses, setInteresses] = useState<Interesse[]>([]);
  const [buscaInteresse, setBuscaInteresse]       = useState("");
  const [resultadosInteresse, setResultadosInteresse] = useState<Interesse[]>([]);
  const [loadingInteresse, setLoadingInteresse]   = useState(false);
  const [atalhos, setAtalhos] = useState<{ id: string; label: string }[]>([]);
  const interesseDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estimativa
  const [estimativa, setEstimativa] = useState<{ alcanceDiario: number | null; alcanceMensal: number | null } | null>(null);
  const [estimando, setEstimando]   = useState(false);
  const estimativaDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gestão de campanha no ar
  const [acaoEmCurso, setAcaoEmCurso]   = useState<string | null>(null);
  const [editandoBudget, setEditandoBudget] = useState<string | null>(null);
  const [novoBudget, setNovoBudget]     = useState(0);

  const buscarCidades = useCallback(async (q: string, setter: (r: CidadeResult[]) => void, loadingSetter: (v: boolean) => void) => {
    if (q.length < 2) { setter([]); return; }
    loadingSetter(true);
    try {
      const res = await fetch(`/api/meta/cidades?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setter(data.cidades ?? []);
    } catch { setter([]); }
    finally { loadingSetter(false); }
  }, []);

  const recarregarCampanhas = useCallback(async () => {
    const r = await fetch(`/api/meta/ads?veiculoId=${veiculoId}`).then(x => x.json()).catch(() => ({ campanhas: [] }));
    setCampanhas(r.campanhas ?? []);
  }, [veiculoId]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErro(null);

    Promise.all([
      fetch("/api/meta/pagina").then(r => r.json()),
      fetch(`/api/meta/ads?veiculoId=${veiculoId}`).then(r => r.json()).catch(() => ({ campanhas: [] })),
      fetch("/api/meta/regioes").then(r => r.json()).catch(() => ({ regioes: [] })),
      fetch("/api/meta/interesses").then(r => r.json()).catch(() => ({ atalhos: [] })),
    ]).then(([paginasData, campanhasData, regioesData, interessesData]) => {
      if (paginasData.error) { setErro(paginasData.error); return; }
      setPaginas(paginasData.salvas ?? []);
      setCampanhas(campanhasData.campanhas ?? []);
      setRegioesDisponiveis(regioesData.regioes ?? []);
      setAtalhos(interessesData.atalhos ?? []);
      if (paginasData.salvas?.[0]) setPaginaId(paginasData.salvas[0].id);
      if (paginasData.cidade) setCidade(paginasData.cidade);
      const conectado = paginasData.adsConectado ?? false;
      if (!conectado) setErroToken(true);
    }).catch(() => setErro("Erro ao carregar dados"))
      .finally(() => setLoading(false));
  }, [open, veiculoId]);

  // Estimativa de alcance: refaz sempre que o público muda, com respiro pro
  // lojista terminar de mexer no slider antes de chamar a Meta.
  useEffect(() => {
    if (!open || !paginaId) return;
    if (estimativaDebounce.current) clearTimeout(estimativaDebounce.current);
    estimativaDebounce.current = setTimeout(async () => {
      setEstimando(true);
      try {
        const res = await fetch("/api/meta/estimativa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paginaId,
            configuracao: {
              placement, objetivo, orcamentoDiario: orcamento, duracaoDias: duracao,
              raioKm: raio, idadeMin, idadeMax, genero,
              interesses: interesses.map(i => ({ id: i.id, nome: i.nome })),
              regioes: modoAlcance === "estado" ? regioes : [],
              cidadesExtras: cidadesExtras.map(c => ({ key: c.key ?? null, nome: c.nome })),
            },
          }),
        });
        const data = await res.json();
        setEstimativa(data.disponivel ? data : null);
      } catch { setEstimativa(null); }
      finally { setEstimando(false); }
    }, 700);
    return () => { if (estimativaDebounce.current) clearTimeout(estimativaDebounce.current); };
  }, [open, paginaId, placement, objetivo, orcamento, duracao, raio, idadeMin, idadeMax,
      genero, interesses, regioes, cidadesExtras, modoAlcance]);

  const buscarInteresses = useCallback(async (q: string) => {
    setLoadingInteresse(true);
    try {
      const res = await fetch(`/api/meta/interesses?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResultadosInteresse(data.interesses ?? []);
    } catch { setResultadosInteresse([]); }
    finally { setLoadingInteresse(false); }
  }, []);

  const carregarAtalho = useCallback(async (id: string) => {
    setLoadingInteresse(true);
    try {
      const res = await fetch(`/api/meta/interesses?atalho=${id}`);
      const data = await res.json();
      setResultadosInteresse(data.interesses ?? []);
    } catch { setResultadosInteresse([]); }
    finally { setLoadingInteresse(false); }
  }, []);

  const addInteresse = (i: Interesse) => {
    setInteresses(prev => prev.some(x => x.id === i.id) ? prev : [...prev, i]);
  };

  const handlePublicar = async () => {
    setPublicando(true);
    setErro(null);
    try {
      const res = await fetch("/api/meta/ads/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veiculoId,
          paginaId: paginaId || undefined,
          objetivo,
          placement,
          tipoOrcamento,
          orcamentoDiario: orcamento,
          orcamentoTotal: tipoOrcamento === "total" ? orcamentoTotal : undefined,
          duracaoDias: duracao,
          semDataFim: tipoOrcamento === "diario" ? semDataFim : false,
          iniciaEm: iniciaEm ? new Date(`${iniciaEm}T09:00:00-03:00`).toISOString() : null,
          raioKm: raio,
          idadeMin,
          idadeMax,
          genero,
          interesses: interesses.map(i => ({ id: i.id, nome: i.nome })),
          comportamentos: [],
          regioes: modoAlcance === "estado" ? regioes : [],
          cidadesExtras: cidadesExtras.map(c => ({ key: c.key ?? null, nome: c.nome })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.includes("Token Meta Ads não configurado")) { setErroToken(true); }
        throw new Error(data.error || "Erro ao criar campanha");
      }
      setSucesso(true);
      await recarregarCampanhas();
      setTimeout(() => setSucesso(false), 4000);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setPublicando(false);
    }
  };

  const mudarStatus = async (campanhaId: string, acao: "pausar" | "retomar" | "cancelar") => {
    if (acao === "cancelar" && !confirm("Encerrar esta campanha? Não dá para desfazer.")) return;
    setAcaoEmCurso(campanhaId);
    setErro(null);
    try {
      const res = await fetch("/api/meta/ads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campanhaId, acao }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao mudar o status");
      await recarregarCampanhas();
    } catch (e: any) { setErro(e.message); }
    finally { setAcaoEmCurso(null); }
  };

  const salvarBudget = async (campanhaId: string) => {
    setAcaoEmCurso(campanhaId);
    setErro(null);
    try {
      const res = await fetch("/api/meta/ads/orcamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campanhaId, orcamentoDiario: novoBudget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar o orçamento");
      setEditandoBudget(null);
      await recarregarCampanhas();
    } catch (e: any) { setErro(e.message); }
    finally { setAcaoEmCurso(null); }
  };

  const veiculoNome = [marca, modelo, ano].filter(Boolean).join(" ");
  const campanhasVivas = campanhas.filter(c => c.status === "ativo" || c.status === "pausado");
  const totalInvestimento = tipoOrcamento === "total"
    ? orcamentoTotal
    : (semDataFim ? orcamento * 30 : orcamento * duracao);
  const orcamentoInvalido = tipoOrcamento === "diario"
    ? orcamento < ORCAMENTO_MINIMO
    : orcamentoTotal < ORCAMENTO_MINIMO * duracao;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-black text-[11px] uppercase tracking-widest transition-all shadow-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Publicar no Meta
        {campanhasVivas.length > 0 && (
          <span className="bg-white/20 rounded-full px-1.5 py-0.5 text-[9px]">{campanhasVivas.length}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[94vh] sm:max-h-[92vh] overflow-y-auto shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-3xl z-20">
              <div className="min-w-0">
                <p className="font-black text-gray-900 text-sm">Publicar no Meta</p>
                <p className="text-[11px] text-gray-400 truncate max-w-[240px]">{veiculoNome || "Veículo"}</p>
              </div>
              <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-blue-500" />
              </div>
            ) : (
              <div className="p-5 space-y-6">

                {/* ── CAMPANHAS NO AR ─────────────────────────────── */}
                {campanhasVivas.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Campanhas deste carro</p>
                    {campanhasVivas.map(c => {
                      const ativa = c.status === "ativo";
                      const cpl = c.leads_gerados > 0 ? c.gasto_total / c.leads_gerados : null;
                      const ocupado = acaoEmCurso === c.id;
                      return (
                        <div key={c.id} className={`rounded-2xl p-3.5 border ${ativa ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-200"}`}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full ${ativa ? "bg-green-500" : "bg-gray-400"}`} />
                              <span className="text-[10px] font-black uppercase tracking-wider text-gray-600">
                                {ativa ? "No ar" : "Pausada"}
                              </span>
                              <span className="text-[10px] text-gray-400 capitalize truncate">
                                · {c.placement.replace(",", " + ")}
                                {c.objetivo === "whatsapp" && " · WhatsApp"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => { setEditandoBudget(editandoBudget === c.id ? null : c.id); setNovoBudget(Number(c.orcamento_diario) || ORCAMENTO_RECOMENDADO); }}
                                disabled={ocupado}
                                title="Mudar orçamento"
                                className="p-1.5 rounded-lg hover:bg-white/70 text-gray-500 disabled:opacity-40"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => mudarStatus(c.id, ativa ? "pausar" : "retomar")}
                                disabled={ocupado}
                                title={ativa ? "Pausar" : "Retomar"}
                                className="p-1.5 rounded-lg hover:bg-white/70 text-gray-500 disabled:opacity-40"
                              >
                                {ocupado ? <Loader2 size={12} className="animate-spin" /> : ativa ? <Pause size={12} /> : <Play size={12} />}
                              </button>
                              <button
                                onClick={() => mudarStatus(c.id, "cancelar")}
                                disabled={ocupado}
                                title="Encerrar"
                                className="p-1.5 rounded-lg hover:bg-white/70 text-red-400 disabled:opacity-40"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2 text-center">
                            {[
                              { l: "Leads", v: String(c.leads_gerados) },
                              { l: "Gasto", v: fmtBRL(Number(c.gasto_total) || 0) },
                              { l: "CPL", v: cpl != null ? fmtBRL(cpl) : "—" },
                              { l: "R$/dia", v: fmtBRL(Number(c.orcamento_diario) || 0) },
                            ].map(k => (
                              <div key={k.l} className="bg-white/70 rounded-xl py-1.5">
                                <p className="text-[11px] font-black text-gray-800 leading-none">{k.v}</p>
                                <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mt-1">{k.l}</p>
                              </div>
                            ))}
                          </div>

                          {editandoBudget === c.id && (
                            <div className="flex items-center gap-2 mt-2.5">
                              <div className="flex-1 flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-gray-200">
                                <span className="text-[11px] font-black text-gray-400">R$</span>
                                <input
                                  type="number" min={ORCAMENTO_MINIMO} value={novoBudget}
                                  onChange={e => setNovoBudget(Number(e.target.value))}
                                  className="w-full text-[12px] font-black text-gray-800 outline-none"
                                />
                                <span className="text-[10px] text-gray-400">/dia</span>
                              </div>
                              <button
                                onClick={() => salvarBudget(c.id)}
                                disabled={ocupado || novoBudget < ORCAMENTO_MINIMO}
                                className="px-4 py-2 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                              >
                                Salvar
                              </button>
                            </div>
                          )}

                          <p className="text-[9px] text-gray-400 mt-2">
                            {c.gasto_total > 0
                              ? "Gasto e leads vêm da Meta, atualizados algumas vezes por dia."
                              : "A Meta ainda não devolveu gasto para esta campanha."}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {paginas.length === 0 && !erro && (
                  <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100 text-center">
                    <p className="text-[12px] font-bold text-orange-700 mb-1">Nenhuma página conectada</p>
                    <p className="text-[11px] text-orange-600">Configure sua Página Facebook em <strong>Configurações → Integração Meta</strong></p>
                  </div>
                )}

                {erroToken && (
                  <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[12px] font-bold text-amber-800 mb-1">Autorização Meta Ads necessária</p>
                        <p className="text-[11px] text-amber-700 leading-snug">
                          Para criar campanhas você precisa conectar sua conta de Ads do Meta uma vez.
                        </p>
                      </div>
                    </div>
                    <a href="/api/meta/connect"
                      className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black uppercase tracking-wider rounded-xl transition-colors">
                      Conectar Meta Ads agora
                    </a>
                  </div>
                )}

                {erro && !erroToken && (
                  <div className="bg-red-50 rounded-2xl p-4 border border-red-100 flex gap-2">
                    <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-700 leading-snug">{erro}</p>
                  </div>
                )}

                {sucesso && (
                  <div className="bg-green-50 rounded-2xl p-4 border border-green-100 flex gap-2">
                    <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-green-700 font-bold">Campanha criada! Cada lead cai direto no WhatsApp da loja.</p>
                  </div>
                )}

                {paginas.length > 0 && (
                  <>
                    {paginas.length > 1 && (
                      <Secao icone={<Facebook size={11} />} titulo="Página">
                        <div className="relative">
                          <select value={paginaId} onChange={e => setPaginaId(e.target.value)}
                            className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[12px] text-gray-700 pr-8">
                            {paginas.map(p => <option key={p.id} value={p.id}>{p.page_name}</option>)}
                          </select>
                          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </Secao>
                    )}

                    {/* ── OBJETIVO ──────────────────────────────────── */}
                    <Secao icone={<Target size={11} />} titulo="O que o lead faz ao clicar"
                      dica={objetivo === "whatsapp"
                        ? "Exige um número de WhatsApp vinculado à Página no Meta Business. Sem isso o Meta recusa a campanha."
                        : "O cliente preenche nome e telefone sem sair do Facebook. O agente puxa esse contato e chama no WhatsApp."}>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { id: "leads",    icone: <FileText size={16} />,      titulo: "Formulário", sub: "Nome + telefone" },
                          { id: "whatsapp", icone: <MessageCircle size={16} />, titulo: "WhatsApp",   sub: "Abre a conversa" },
                        ] as const).map(o => (
                          <button key={o.id} onClick={() => setObjetivo(o.id)}
                            className={`flex flex-col items-center gap-1 py-3 rounded-2xl border-2 transition-all ${
                              objetivo === o.id ? "border-blue-500 bg-blue-50" : "border-gray-100 bg-gray-50 hover:border-gray-200"
                            }`}>
                            <span className={objetivo === o.id ? "text-blue-600" : "text-gray-400"}>{o.icone}</span>
                            <span className={`text-[10px] font-black uppercase tracking-wide ${objetivo === o.id ? "text-blue-700" : "text-gray-500"}`}>{o.titulo}</span>
                            <span className="text-[9px] text-gray-400">{o.sub}</span>
                          </button>
                        ))}
                      </div>
                    </Secao>

                    {/* ── ONDE PUBLICAR ─────────────────────────────── */}
                    <Secao icone={<Instagram size={11} />} titulo="Onde publicar">
                      <div className="grid grid-cols-3 gap-2">
                        {(["facebook", "instagram", "facebook,instagram"] as const).map(p => (
                          <button key={p} onClick={() => setPlacement(p)}
                            className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all ${
                              placement === p ? "border-blue-500 bg-blue-50" : "border-gray-100 bg-gray-50 hover:border-gray-200"
                            }`}>
                            {p === "facebook" && <Facebook size={18} className={placement === p ? "text-blue-600" : "text-gray-400"} />}
                            {p === "instagram" && <Instagram size={18} className={placement === p ? "text-purple-600" : "text-gray-400"} />}
                            {p === "facebook,instagram" && (
                              <div className="flex gap-1">
                                <Facebook size={14} className={placement === p ? "text-blue-600" : "text-gray-400"} />
                                <Instagram size={14} className={placement === p ? "text-purple-600" : "text-gray-400"} />
                              </div>
                            )}
                            <span className={`text-[9px] font-black uppercase tracking-wide ${placement === p ? "text-blue-700" : "text-gray-400"}`}>
                              {p === "facebook" ? "Facebook" : p === "instagram" ? "Instagram" : "Ambos"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </Secao>

                    {/* ── ALCANCE ───────────────────────────────────── */}
                    <Secao icone={<MapPin size={11} />} titulo="Até onde o anúncio vai">
                      <div className="flex gap-2 mb-3">
                        {([
                          { id: "raio",   label: "Raio da loja" },
                          { id: "estado", label: "Estado inteiro" },
                        ] as const).map(m => (
                          <button key={m.id} onClick={() => setModoAlcance(m.id)}
                            className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all border ${
                              modoAlcance === m.id ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                            }`}>
                            {m.label}
                          </button>
                        ))}
                      </div>

                      {modoAlcance === "raio" ? (
                        <>
                          {/* Cidade principal */}
                          <div className="mb-3 relative">
                            <p className="text-[9px] text-gray-400 mb-1.5">Cidade principal</p>
                            <div className="relative">
                              <input type="text" autoComplete="off"
                                value={buscaPrincipal !== "" ? buscaPrincipal : cidade}
                                onChange={e => {
                                  const v = e.target.value;
                                  setBuscaPrincipal(v); setCidade(v); setShowDropdownPrincipal(true);
                                  if (debounceRef.current) clearTimeout(debounceRef.current);
                                  debounceRef.current = setTimeout(() => buscarCidades(v, setResultadosPrincipal, setLoadingPrincipal), 300);
                                }}
                                onFocus={() => { setBuscaPrincipal(cidade); setShowDropdownPrincipal(true); buscarCidades(cidade, setResultadosPrincipal, setLoadingPrincipal); }}
                                onBlur={() => setTimeout(() => { setShowDropdownPrincipal(false); setBuscaPrincipal(""); }, 180)}
                                placeholder="Digite o nome da cidade..."
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[12px] text-gray-700 placeholder-gray-300 pr-8"
                              />
                              {loadingPrincipal
                                ? <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
                                : <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />}
                            </div>
                            {showDropdownPrincipal && resultadosPrincipal.length > 0 && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                                {resultadosPrincipal.map((c, i) => (
                                  <button key={`${c.nome}-${i}`}
                                    onMouseDown={() => { setCidade(c.nome); setBuscaPrincipal(""); setResultadosPrincipal([]); setShowDropdownPrincipal(false); }}
                                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0">
                                    <span className="text-[12px] text-gray-700 font-medium">{c.nome}</span>
                                    <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-lg">{c.estado}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Outras cidades */}
                          <div className="mb-4">
                            <p className="text-[9px] text-gray-400 mb-1.5">Adicionar outras cidades</p>
                            {cidadesExtras.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {cidadesExtras.map((c, i) => (
                                  <span key={`extra-${c.nome}-${i}`} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">
                                    {c.nome}{c.estado ? ` – ${c.estado}` : ""}
                                    <button onClick={() => setCidadesExtras(prev => prev.filter((_, idx) => idx !== i))}
                                      className="w-4 h-4 flex items-center justify-center hover:bg-blue-200 rounded-full transition-colors">
                                      <X size={9} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="relative">
                              <input type="text" autoComplete="off" value={buscaCidade}
                                onChange={e => {
                                  const v = e.target.value;
                                  setBuscaCidade(v); setShowDropdown(true);
                                  if (debounceRef.current) clearTimeout(debounceRef.current);
                                  debounceRef.current = setTimeout(() => buscarCidades(v, setResultadosCidades, setLoadingCidades), 300);
                                }}
                                onFocus={() => { setShowDropdown(true); if (buscaCidade.length >= 2) buscarCidades(buscaCidade, setResultadosCidades, setLoadingCidades); }}
                                onBlur={() => setTimeout(() => setShowDropdown(false), 180)}
                                placeholder="Buscar qualquer cidade do Brasil..."
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 placeholder-gray-300 pr-8"
                              />
                              {loadingCidades
                                ? <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
                                : <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />}
                              {showDropdown && resultadosCidades.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                                  {resultadosCidades
                                    .filter(c => !cidadesExtras.some(x => x.nome === c.nome) && c.nome.toLowerCase() !== cidade.toLowerCase())
                                    .map((c, i) => (
                                      <button key={`res-${c.nome}-${i}`}
                                        onMouseDown={() => { setCidadesExtras(prev => [...prev, c]); setBuscaCidade(""); setResultadosCidades([]); setShowDropdown(false); }}
                                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0">
                                        <span className="text-[12px] text-gray-700 font-medium">{c.nome}</span>
                                        <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-lg">{c.estado}</span>
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Raio */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[9px] text-gray-400">Raio por cidade</p>
                              <p className="text-[13px] font-black text-gray-800">{raio} km</p>
                            </div>
                            <div className="flex gap-1 mb-2">
                              {RAIO_PRESETS.map(v => (
                                <button key={v} onClick={() => setRaio(v)}
                                  className={`flex-1 py-1.5 rounded-xl text-[9px] font-black transition-all ${
                                    raio === v ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                  }`}>
                                  {v}
                                </button>
                              ))}
                            </div>
                            <input type="range" min={5} max={RAIO_MAX} step={5} value={raio}
                              onChange={e => setRaio(Number(e.target.value))} className="w-full accent-blue-500" />
                            <div className="flex items-start gap-1.5 mt-2 bg-gray-50 rounded-xl p-2.5">
                              <Info size={11} className="text-gray-400 shrink-0 mt-0.5" />
                              <p className="text-[9px] text-gray-500 leading-snug">
                                {RAIO_MAX} km é o teto do Meta para raio. Para vender mais longe, use <strong>Estado inteiro</strong>.
                              </p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div>
                          {regioes.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {regioes.map(r => (
                                <span key={r.key} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">
                                  {r.nome}
                                  <button onClick={() => setRegioes(prev => prev.filter(x => x.key !== r.key))}
                                    className="w-4 h-4 flex items-center justify-center hover:bg-blue-200 rounded-full transition-colors">
                                    <X size={9} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                            {regioesDisponiveis
                              .filter(r => !regioes.some(x => x.key === r.key))
                              .map(r => (
                                <button key={r.key} onClick={() => setRegioes(prev => [...prev, r])}
                                  className="px-2.5 py-1.5 rounded-full text-[10px] font-bold bg-white text-gray-500 border border-gray-200 hover:border-blue-300 hover:text-blue-600 transition-all">
                                  {r.nome}
                                </button>
                              ))}
                          </div>
                          {regioesDisponiveis.length === 0 && (
                            <p className="text-[10px] text-gray-400">Conecte o Meta Ads para carregar os estados.</p>
                          )}
                          <p className="text-[9px] text-gray-300 mt-2 leading-snug">
                            Estado inteiro ignora o teto de raio. Bom para carro raro, que vale a viagem do comprador.
                          </p>
                        </div>
                      )}
                    </Secao>

                    {/* ── PÚBLICO ───────────────────────────────────── */}
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-4">
                      <div className="flex items-center gap-1.5">
                        <Users size={11} className="text-gray-400" />
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Quem vê o anúncio</p>
                      </div>

                      {/* Idade */}
                      <div>
                        <div className="flex justify-between mb-1.5">
                          <p className="text-[9px] text-gray-500 font-bold">Faixa etária</p>
                          <p className="text-[10px] font-black text-gray-700">{idadeMin} – {idadeMax} anos</p>
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <p className="text-[8px] text-gray-400 mb-1">Mínima</p>
                            <input type="number" min={18} max={idadeMax - 1} value={idadeMin}
                              onChange={e => setIdadeMin(Number(e.target.value))}
                              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-center" />
                          </div>
                          <div className="flex-1">
                            <p className="text-[8px] text-gray-400 mb-1">Máxima</p>
                            <input type="number" min={idadeMin + 1} max={65} value={idadeMax}
                              onChange={e => setIdadeMax(Number(e.target.value))}
                              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-center" />
                          </div>
                        </div>
                      </div>

                      {/* Gênero */}
                      <div>
                        <p className="text-[9px] text-gray-500 font-bold mb-1.5">Gênero</p>
                        <div className="flex gap-2">
                          {([
                            { id: "todos", label: "Todos" },
                            { id: "masculino", label: "Masculino" },
                            { id: "feminino", label: "Feminino" },
                          ] as const).map(g => (
                            <button key={g.id} onClick={() => setGenero(g.id)}
                              className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all border ${
                                genero === g.id ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                              }`}>
                              {g.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Interesses — busca ao vivo */}
                      <div>
                        <p className="text-[9px] text-gray-500 font-bold mb-1.5">Interesses</p>

                        {interesses.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {interesses.map(i => (
                              <span key={i.id} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-blue-500 text-white rounded-full text-[10px] font-bold">
                                {i.nome}
                                <button onClick={() => setInteresses(prev => prev.filter(x => x.id !== i.id))}
                                  className="w-4 h-4 flex items-center justify-center hover:bg-blue-600 rounded-full transition-colors">
                                  <X size={9} />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Atalhos por intenção */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {atalhos.map(a => (
                            <button key={a.id} onClick={() => carregarAtalho(a.id)}
                              className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wide bg-white text-gray-500 border border-gray-200 hover:border-blue-300 hover:text-blue-600 transition-all">
                              {a.label}
                            </button>
                          ))}
                        </div>

                        <div className="relative">
                          <input type="text" autoComplete="off" value={buscaInteresse}
                            onChange={e => {
                              const v = e.target.value;
                              setBuscaInteresse(v);
                              if (interesseDebounce.current) clearTimeout(interesseDebounce.current);
                              if (v.length < 2) { setResultadosInteresse([]); return; }
                              interesseDebounce.current = setTimeout(() => buscarInteresses(v), 350);
                            }}
                            placeholder="Buscar interesse na Meta..."
                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 placeholder-gray-300 pr-8" />
                          {loadingInteresse
                            ? <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
                            : <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />}
                        </div>

                        {resultadosInteresse.length > 0 && (
                          <div className="mt-2 max-h-44 overflow-y-auto bg-white border border-gray-200 rounded-2xl divide-y divide-gray-50">
                            {resultadosInteresse
                              .filter(i => !interesses.some(x => x.id === i.id))
                              .map(i => (
                                <button key={i.id} onClick={() => addInteresse(i)}
                                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-blue-50 transition-colors text-left">
                                  <div className="min-w-0">
                                    <p className="text-[11px] text-gray-700 font-bold truncate">{i.nome}</p>
                                    {i.caminho && <p className="text-[9px] text-gray-300 truncate">{i.caminho}</p>}
                                  </div>
                                  {i.alcance ? (
                                    <span className="text-[9px] font-black text-gray-400 shrink-0">{fmtNum(i.alcance)}</span>
                                  ) : null}
                                </button>
                              ))}
                          </div>
                        )}
                        <p className="text-[9px] text-gray-300 mt-1.5 leading-snug">
                          Sem interesse marcado, o Meta entrega para todo mundo da região — costuma ser o certo para carro popular.
                        </p>
                      </div>
                    </div>

                    {/* ── ESTIMATIVA ────────────────────────────────── */}
                    <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Público estimado</p>
                          <p className="text-lg font-black text-indigo-900 leading-tight mt-0.5">
                            {estimando ? "…" : estimativa?.alcanceMensal ? fmtNum(estimativa.alcanceMensal) : "—"}
                            <span className="text-[10px] font-bold text-indigo-400 ml-1.5">pessoas alcançáveis</span>
                          </p>
                        </div>
                        {estimando
                          ? <Loader2 size={18} className="animate-spin text-indigo-400" />
                          : <Users size={18} className="text-indigo-300" />}
                      </div>
                      <p className="text-[9px] text-indigo-400 mt-2 leading-snug">
                        {estimativa
                          ? "Número do próprio Meta para esta segmentação. Muito baixo = público apertado demais; muito alto = dinheiro espalhado."
                          : "A estimativa aparece quando a conta de Ads estiver conectada e a segmentação for válida."}
                      </p>
                    </div>

                    {/* ── INVESTIMENTO ──────────────────────────────── */}
                    <Secao icone={<Wallet size={11} />} titulo="Investimento">
                      <div className="flex gap-2 mb-3">
                        {([
                          { id: "diario", label: "Por dia" },
                          { id: "total",  label: "Valor total" },
                        ] as const).map(t => (
                          <button key={t.id} onClick={() => setTipoOrcamento(t.id)}
                            className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all border ${
                              tipoOrcamento === t.id ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                            }`}>
                            {t.label}
                          </button>
                        ))}
                      </div>

                      {tipoOrcamento === "diario" ? (
                        <>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {ORCAMENTOS.map(v => (
                              <button key={v} onClick={() => setOrcamento(v)}
                                className={`relative flex-1 min-w-[40px] py-2 rounded-xl text-[10px] font-black transition-all ${
                                  orcamento === v ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                }`}>
                                {v}
                                {v === ORCAMENTO_RECOMENDADO && (
                                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-green-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full leading-none">
                                    ★ TOP
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-200">
                            <span className="text-[11px] font-black text-gray-400">R$</span>
                            <input type="number" min={ORCAMENTO_MINIMO} value={orcamento}
                              onChange={e => setOrcamento(Number(e.target.value))}
                              className="w-full bg-transparent text-[13px] font-black text-gray-800 outline-none" />
                            <span className="text-[10px] text-gray-400 shrink-0">por dia</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-200">
                          <span className="text-[11px] font-black text-gray-400">R$</span>
                          <input type="number" min={ORCAMENTO_MINIMO * duracao} value={orcamentoTotal}
                            onChange={e => setOrcamentoTotal(Number(e.target.value))}
                            className="w-full bg-transparent text-[13px] font-black text-gray-800 outline-none" />
                          <span className="text-[10px] text-gray-400 shrink-0">no período</span>
                        </div>
                      )}

                      {orcamentoInvalido && (
                        <p className="text-[9px] text-red-500 font-bold mt-1.5">
                          {tipoOrcamento === "diario"
                            ? `O Meta exige no mínimo R$ ${ORCAMENTO_MINIMO},00 por dia.`
                            : `Para ${duracao} dias, o mínimo é ${fmtBRL(ORCAMENTO_MINIMO * duracao)}.`}
                        </p>
                      )}
                    </Secao>

                    {/* ── PRAZO ─────────────────────────────────────── */}
                    <Secao icone={<CalendarClock size={11} />} titulo="Prazo">
                      <div className="flex gap-1 mb-2">
                        {DURACOES.map(v => (
                          <button key={v} onClick={() => { setDuracao(v); setSemDataFim(false); }}
                            disabled={semDataFim}
                            className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-40 ${
                              duracao === v && !semDataFim ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}>
                            {v}d
                          </button>
                        ))}
                        <input type="number" min={1} max={365} value={duracao} disabled={semDataFim}
                          onChange={e => setDuracao(Math.max(1, Number(e.target.value)))}
                          className="w-16 bg-gray-50 border border-gray-200 rounded-xl px-2 py-2 text-[11px] font-black text-center disabled:opacity-40" />
                      </div>

                      {tipoOrcamento === "diario" && (
                        <button onClick={() => setSemDataFim(v => !v)}
                          className={`w-full py-2 rounded-xl text-[10px] font-black transition-all border mb-2 ${
                            semDataFim ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                          }`}>
                          {semDataFim ? "✓ Roda até eu pausar" : "Deixar rodando sem data de fim"}
                        </button>
                      )}

                      <div>
                        <p className="text-[9px] text-gray-400 mb-1.5">Começar em (vazio = agora)</p>
                        <input type="date" value={iniciaEm} min={new Date().toISOString().slice(0, 10)}
                          onChange={e => setIniciaEm(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700" />
                      </div>

                      {tipoOrcamento === "total" && (
                        <p className="text-[9px] text-gray-300 mt-1.5 leading-snug">
                          Valor total exige data de fim — o Meta precisa saber em quantos dias distribuir a verba.
                        </p>
                      )}
                    </Secao>

                    {/* ── RESUMO ────────────────────────────────────── */}
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-1.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">{semDataFim ? "Gasto estimado em 30 dias" : "Investimento total"}</span>
                        <span className="font-black text-gray-900">{fmtBRL(totalInvestimento)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Prazo</span>
                        <span className="font-bold text-gray-700">{semDataFim ? "Sem data de fim" : `${duracao} dias`}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Alcance</span>
                        <span className="font-bold text-gray-700 text-right">
                          {modoAlcance === "estado"
                            ? (regioes.length ? regioes.map(r => r.nome).join(", ") : "Nenhum estado escolhido")
                            : `${cidade || "—"}${cidadesExtras.length ? ` +${cidadesExtras.length}` : ""} · ${raio} km`}
                        </span>
                      </div>
                      <div className="h-px bg-gray-200 my-1" />
                      <div className="flex items-start gap-2 bg-green-50 rounded-xl p-2.5 border border-green-100">
                        <Zap size={12} className="text-green-600 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-green-700 leading-snug">
                          {objetivo === "whatsapp"
                            ? "O cliente já abre a conversa citando o carro — o agente IA responde na hora."
                            : "O telefone do formulário vai direto para o agente IA, que chama o cliente no WhatsApp."}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handlePublicar}
                      disabled={publicando || !fotoUrl || orcamentoInvalido || (modoAlcance === "estado" && regioes.length === 0)}
                      className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-black text-[12px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      {publicando
                        ? <><Loader2 size={16} className="animate-spin" /> Criando campanha...</>
                        : "Publicar agora"}
                    </button>

                    {!fotoUrl && <p className="text-center text-[10px] text-orange-500">Adicione uma foto ao veículo para criar o anúncio</p>}
                    {modoAlcance === "estado" && regioes.length === 0 && (
                      <p className="text-center text-[10px] text-orange-500">Escolha pelo menos um estado</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
