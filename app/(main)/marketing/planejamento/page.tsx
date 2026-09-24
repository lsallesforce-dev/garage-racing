"use client";

// Planejamento de Postagens — os ANÚNCIOS PAGOS (Meta Ads) do mês numa tela só.
//
// Por que existe: o modal "Anunciar no Meta Ads" publica na hora, um carro por
// vez, e não mostra quanto o mês inteiro vai custar. O dono queria montar a
// semana antes (rascunho → agendado), ver o que cabe no saldo da conta de
// anúncios e acompanhar os números como no Gerenciador da Meta — sem abrir o
// Gerenciador. Os números vêm do backend (/api/meta/planejamento), que junta o
// saldo da conta com as métricas reais das campanhas.
//
// ⚠️ Toda ação daqui que publica/ativa gasta dinheiro real do cliente — por isso
// cada uma pede confirmação explícita com valor e data.
//
// Sem loading.tsx de propósito: carga direta de rota com loading.tsx fica
// presa no spinner neste projeto (fronteira de Suspense desidratada).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Plus, RefreshCw, Wallet, TrendingUp, PiggyBank,
  Receipt, ExternalLink, Pause, Play, Pencil, Trash2, Send, Search, X,
  Megaphone, AlertCircle, Loader2, CalendarDays, ArrowLeft, Info,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import PublicarMetaButton from "@/components/PublicarMetaButton";
import { COLUNAS_MIDIA, melhorFormato, midiaDoVeiculo, miniatura, type FormatoAnuncio, type VeiculoMidiaRow } from "@/lib/veiculo-midia";

// ─── Contrato do backend (GET /api/meta/planejamento) ────────────────────────

type StatusPlano = "rascunho" | "publicando" | "cancelado" | "agendado" | "ativo" | "pausado" | "encerrado" | "erro";

interface Metricas {
  gasto: number | null;
  impressoes: number | null;
  alcance: number | null;
  cliques: number | null;
  cpc: number | null;
  ctr: number | null;
  frequencia: number | null;
  leads: number | null;
  conversas: number | null;
  resultados: number | null;
  custo_resultado: number | null;
}

interface CampanhaPlano {
  id: string;
  /** "gerenciador" = post turbinado / campanha feita fora do AutoZap — só leitura. */
  origem?: "autozap" | "gerenciador";
  nome?: string | null;
  status: StatusPlano;
  meta_status: string | null;
  veiculo: { id: string; nome: string; thumb: string | null } | null;
  veiculo_ids: string[] | null;
  formato: string | null;
  objetivo: string | null;
  placement: string | null;
  inicia_em: string | null;
  encerra_em: string | null;
  orcamento_diario: number | null;
  tipo_orcamento: string | null;
  orcamento_total: number | null;
  duracao_dias: number | null;
  sem_data_fim: boolean | null;
  idade_min: number | null;
  idade_max: number | null;
  genero: string | null;
  thumb: string | null;
  metricas: Partial<Metricas> | null;
  metricas_em: string | null;
  previsto_mes: number | null;
  erro_msg: string | null;
  gerenciador_url: string | null;
  payload?: any;
}

interface Planejamento {
  saldo: {
    disponivel: number | null;
    moeda: string | null;
    prepago: boolean | null;
    texto: string | null;
    contaId: string | null;
    contaNome: string | null;
    limiteGasto: number | null;
    gastoTotalConta: number | null;
    erro?: string;
  };
  previsaoMes: number;
  aGastarRestante: number;
  saldoProjetado: number | null;
  gastoMes: number;
  atualizadoEm: string;
  campanhas: CampanhaPlano[];
}

interface CarroEstoque extends VeiculoMidiaRow {
  id: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano: number | string | null;
  ano_modelo: number | string | null;
  preco_sugerido: number | null;
  status_venda: string | null;
}

/** O que o modal de anúncio precisa pra abrir — novo ou editando rascunho. */
interface ModalAnuncio {
  veiculoId: string;
  marca: string;
  modelo: string;
  ano: string | number;
  fotoUrl: string | null;
  formatoInicial?: FormatoAnuncio;
  rascunhoId?: string;
  payload?: any;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TZ = "America/Sao_Paulo";

const brl = (v: number | null | undefined, casas = 2) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });

const inteiro = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("pt-BR");

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const dataHora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

const soData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }) : "—";

/** Mês corrente em Brasília (YYYY-MM) — o navegador pode estar em outro fuso. */
function mesAtualBRT(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
}

function somarMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function rotuloMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const nome = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });
  return `${nome} ${y}`;
}

function haQuanto(iso: string | null | undefined, agora: number): string {
  if (!iso) return "";
  const min = Math.floor((agora - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min)) return "";
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

/** Fim da veiculação: data explícita, ou início + duração; null = contínua. */
function fimDe(c: CampanhaPlano): string | null {
  if (c.sem_data_fim) return null;
  if (c.encerra_em) return c.encerra_em;
  if (c.inicia_em && c.duracao_dias) {
    return new Date(new Date(c.inicia_em).getTime() + c.duracao_dias * 86_400_000).toISOString();
  }
  return null;
}

/** Quanto a campanha custa inteira — o número que a confirmação mostra. */
function valorTotal(c: CampanhaPlano): { valor: number; estimado: boolean } {
  if (c.tipo_orcamento === "total" && c.orcamento_total) return { valor: Number(c.orcamento_total), estimado: false };
  const dia = Number(c.orcamento_diario) || 0;
  // Sem data de fim não existe "total": 30 dias é a mesma régua do modal.
  if (c.sem_data_fim) return { valor: dia * 30, estimado: true };
  return { valor: dia * (Number(c.duracao_dias) || 0), estimado: false };
}

/** Resultado conforme o objetivo — conversa no WhatsApp ou lead do formulário. */
function resultadoDe(c: CampanhaPlano): { n: number | null; rotulo: string } {
  const m = c.metricas ?? {};
  if (c.objetivo === "whatsapp") return { n: m.conversas ?? m.resultados ?? null, rotulo: "conversas" };
  if (c.objetivo === "leads") return { n: m.leads ?? m.resultados ?? null, rotulo: "leads" };
  return { n: m.resultados ?? null, rotulo: "resultados" };
}

function custoResultado(c: CampanhaPlano): number | null {
  const m = c.metricas ?? {};
  if (m.custo_resultado != null) return m.custo_resultado;
  const r = resultadoDe(c).n;
  return r && m.gasto ? m.gasto / r : null;
}

// ─── Status ──────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<StatusPlano, { label: string; cls: string; dot: string }> = {
  rascunho:  { label: "Rascunho",  cls: "bg-gray-100 text-gray-500",   dot: "bg-gray-400" },
  // Trava do servidor enquanto cria na Meta. Sem ação de propósito: se ficar
  // presa (servidor caiu no meio), a campanha PODE já existir lá — conferir no
  // Gerenciador antes de qualquer coisa, pra não pagar duas vezes.
  publicando: { label: "Publicando…", cls: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
  agendado:  { label: "Agendado",  cls: "bg-blue-100 text-blue-700",   dot: "bg-blue-500" },
  ativo:     { label: "Ativo",     cls: "bg-green-100 text-green-700", dot: "bg-green-500" },
  pausado:   { label: "Pausado",   cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  encerrado: { label: "Encerrado", cls: "bg-gray-700 text-gray-100",   dot: "bg-gray-300" },
  // Cancelada antes de rodar. Sem config própria caía no fallback "Rascunho"
  // — COM botão Publicar — num anúncio que nunca foi rascunho (Onix da APROVE).
  cancelado: { label: "Cancelado", cls: "bg-gray-100 text-gray-400",   dot: "bg-gray-300" },
  erro:      { label: "Erro",      cls: "bg-red-100 text-red-600",     dot: "bg-red-500" },
};

// Status da Meta que o lojista precisa ver: "ativo" aqui com anúncio em
// análise ou reprovado lá não é "no ar" de verdade.
const META_STATUS_PT: Record<string, string> = {
  PENDING_REVIEW: "em análise na Meta",
  IN_PROCESS: "processando na Meta",
  DISAPPROVED: "reprovado pela Meta",
  WITH_ISSUES: "com problema na Meta",
  PREAPPROVED: "pré-aprovado",
  PENDING_BILLING_INFO: "falta pagamento na Meta",
  CAMPAIGN_PAUSED: "campanha pausada na Meta",
  ADSET_PAUSED: "conjunto pausado na Meta",
  PAUSED: "pausado na Meta",
  ARCHIVED: "arquivado na Meta",
  DELETED: "excluído na Meta",
};

function metaStatusUtil(c: CampanhaPlano): string | null {
  const ms = (c.meta_status ?? "").toUpperCase();
  if (!ms || c.status === "rascunho") return null;
  if (ms === "ACTIVE" && (c.status === "ativo" || c.status === "agendado")) return null;
  if (ms === "PAUSED" && c.status === "pausado") return null;
  return META_STATUS_PT[ms] ?? ms.toLowerCase().replace(/_/g, " ");
}

function StatusPill({ c }: { c: CampanhaPlano }) {
  // Status desconhecido mostra o próprio nome, neutro — nunca "Rascunho".
  const cfg = STATUS_CFG[c.status] ?? { label: String(c.status), cls: "bg-gray-100 text-gray-500", dot: "bg-gray-400" };
  const extra = metaStatusUtil(c);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span
        title={c.status === "erro" ? c.erro_msg ?? undefined : undefined}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${cfg.cls}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
      {extra && <span className="text-[9px] font-bold text-gray-400 pl-1">{extra}</span>}
    </div>
  );
}

const FILTROS: { id: "todos" | "rascunho" | "agendado" | "ativos" | "encerrados"; label: string; casa: (s: StatusPlano) => boolean }[] = [
  { id: "todos",      label: "Todos",      casa: () => true },
  { id: "rascunho",   label: "Rascunhos",  casa: s => s === "rascunho" },
  { id: "agendado",   label: "Agendados",  casa: s => s === "agendado" },
  // Pausado conta como ativo: ainda é campanha viva, só parada.
  { id: "ativos",     label: "Ativos",     casa: s => s === "ativo" || s === "pausado" },
  { id: "encerrados", label: "Encerrados", casa: s => s === "encerrado" || s === "erro" || s === "cancelado" },
];

// ─── Miniatura ───────────────────────────────────────────────────────────────

function Thumb({ url, lado = 44 }: { url: string | null | undefined; lado?: number }) {
  // Artes do kit são PNG de ~1,7 MB — sempre a versão reduzida do Storage.
  const src = miniatura(url, lado);
  return (
    <div className="shrink-0 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center" style={{ width: lado, height: lado }}>
      {src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : <Megaphone size={16} className="text-gray-300" />}
    </div>
  );
}

function nomeCampanha(c: CampanhaPlano): string {
  if (c.veiculo?.nome) return c.veiculo.nome;
  if (c.nome) return c.nome;
  const n = c.veiculo_ids?.length ?? 0;
  return n > 1 ? `Estoque · ${n} carros` : "Anúncio";
}

function detalheCampanha(c: CampanhaPlano): string {
  const partes = [
    c.origem === "gerenciador" ? "Criada no Gerenciador" : null,
    c.formato,
    c.objetivo === "whatsapp" ? "WhatsApp" : c.objetivo === "leads" ? "Formulário" : null,
    c.placement === "stories" ? "Só stories" : c.placement?.replace(",", " + "),
  ].filter(Boolean);
  return partes.join(" · ");
}

// ─── Card do topo ────────────────────────────────────────────────────────────

function CardResumo({ icone, titulo, valor, sub, tom = "neutro", children }: {
  icone: React.ReactNode; titulo: string; valor: string; sub?: React.ReactNode;
  tom?: "neutro" | "verde" | "vermelho"; children?: React.ReactNode;
}) {
  const cor = tom === "verde" ? "text-green-600" : tom === "vermelho" ? "text-red-600" : "text-gray-900";
  return (
    <div className={`bg-white rounded-3xl border p-5 shadow-sm ${tom === "vermelho" ? "border-red-200" : "border-gray-100"}`}>
      <div className="flex items-center gap-1.5 mb-3 text-gray-400">
        {icone}
        <p className="text-[9px] font-black uppercase tracking-widest">{titulo}</p>
      </div>
      <p className={`text-2xl md:text-3xl font-black italic leading-none tracking-tight ${cor}`}>{valor}</p>
      {sub && <div className="text-[10px] font-bold text-gray-400 mt-2 leading-snug">{sub}</div>}
      {children}
    </div>
  );
}

// ─── Seletor de carro (passo 1 do "Adicionar postagem") ──────────────────────

function SeletorCarro({ carros, carregando, onEscolher, onFechar }: {
  carros: CarroEstoque[]; carregando: boolean;
  onEscolher: (c: CarroEstoque) => void; onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return carros;
    return carros.filter(c =>
      [c.marca, c.modelo, c.versao, c.ano_modelo ?? c.ano].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [busca, carros]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onFechar}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <p className="font-black text-gray-900 text-sm">Qual carro anunciar?</p>
            <p className="text-[11px] text-gray-400">Passo 1 de 2 · só carros disponíveis</p>
          </div>
          <button onClick={onFechar} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-50">
          <div className="relative">
            <input
              autoFocus value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar marca, modelo, ano..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[12px] text-gray-700 placeholder-gray-300 pr-8"
            />
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
          </div>
        </div>

        <div className="overflow-y-auto p-2 flex-1">
          {carregando ? (
            <div className="py-12 flex justify-center"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
          ) : filtrados.length === 0 ? (
            <p className="py-12 text-center text-[10px] font-black uppercase tracking-widest text-gray-300">
              {carros.length === 0 ? "Nenhum carro disponível no estoque" : "Nada encontrado"}
            </p>
          ) : filtrados.map(c => {
            const midia = midiaDoVeiculo(c);
            const semFoto = !midia.imagemPadrao;
            return (
              <button
                key={c.id} disabled={semFoto} onClick={() => onEscolher(c)}
                title={semFoto ? "Adicione uma foto ao veículo pra anunciar" : undefined}
                className="w-full flex items-center gap-3 p-2.5 rounded-2xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-left transition-colors"
              >
                <Thumb url={midia.imagemPadrao} lado={56} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-black uppercase italic text-gray-900 truncate">{c.marca} {c.modelo}</p>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">
                    {c.versao || "—"} • {c.ano_modelo ?? c.ano ?? "—"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] font-black text-gray-800">{brl(c.preco_sugerido, 0)}</p>
                  {semFoto
                    ? <p className="text-[9px] font-bold text-orange-500">sem foto</p>
                    : midia.capaKit && <p className="text-[9px] font-bold text-indigo-500">kit pronto</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Ações por campanha ──────────────────────────────────────────────────────

type Acao = "publicar" | "excluir" | "pausar" | "ativar";

function BotoesAcao({ c, ocupado, onAcao, onEditar, compacto = false }: {
  c: CampanhaPlano; ocupado: boolean;
  onAcao: (c: CampanhaPlano, a: Acao) => void; onEditar: (c: CampanhaPlano) => void;
  compacto?: boolean;
}) {
  const base = compacto
    ? "p-2 rounded-xl transition-colors disabled:opacity-40"
    : "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-colors disabled:opacity-40";
  const rot = (t: string) => (compacto ? null : t);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {ocupado && <Loader2 size={14} className="animate-spin text-gray-400 mx-1" />}
      {c.status === "rascunho" && (
        <>
          <button disabled={ocupado} onClick={() => onAcao(c, "publicar")} title="Publicar / agendar"
            className={`${base} bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700`}>
            <Send size={12} />{rot("Publicar")}
          </button>
          {/* Carrossel de estoque (vários carros) não abre no modal de um carro só. */}
          {c.veiculo?.id && (
            <button disabled={ocupado} onClick={() => onEditar(c)} title="Editar"
              className={`${base} bg-gray-100 text-gray-600 hover:bg-gray-200`}>
              <Pencil size={12} />{rot("Editar")}
            </button>
          )}
          <button disabled={ocupado} onClick={() => onAcao(c, "excluir")} title="Excluir rascunho"
            className={`${base} text-red-500 hover:bg-red-50`}>
            <Trash2 size={12} />{rot("Excluir")}
          </button>
        </>
      )}
      {/* Campanha de fora do AutoZap: pausar/ativar é no Gerenciador (a rota
          de status só conhece as linhas de meta_campanhas). */}
      {c.origem !== "gerenciador" && (c.status === "ativo" || c.status === "agendado") && (
        <button disabled={ocupado} onClick={() => onAcao(c, "pausar")} title="Pausar"
          className={`${base} bg-amber-50 text-amber-700 hover:bg-amber-100`}>
          <Pause size={12} />{rot("Pausar")}
        </button>
      )}
      {c.origem !== "gerenciador" && c.status === "pausado" && (
        <button disabled={ocupado} onClick={() => onAcao(c, "ativar")} title="Ativar"
          className={`${base} bg-green-50 text-green-700 hover:bg-green-100`}>
          <Play size={12} />{rot("Ativar")}
        </button>
      )}
      {c.gerenciador_url && (
        <a href={c.gerenciador_url} target="_blank" rel="noopener noreferrer" title="Abrir no Gerenciador de Anúncios"
          className={`${base} text-gray-400 hover:text-gray-700 hover:bg-gray-100`}>
          <ExternalLink size={12} />{rot("Gerenciador")}
        </a>
      )}
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function PlanejamentoPage() {
  const { effectiveUserId } = useUserRole();

  const [mes, setMes] = useState(mesAtualBRT);
  const [dados, setDados] = useState<Planejamento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("todos");
  const [acaoEm, setAcaoEm] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const [carros, setCarros] = useState<CarroEstoque[]>([]);
  const [carregandoCarros, setCarregandoCarros] = useState(false);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [modal, setModal] = useState<ModalAnuncio | null>(null);

  // Troca rápida de mês: só a resposta do pedido mais recente pode pintar a tela.
  const pedidoRef = useRef(0);
  const mesRef = useRef(mes);
  useEffect(() => { mesRef.current = mes; }, [mes]);
  const syncInicialFeito = useRef(false);

  const carregar = useCallback(async (m: string, silencioso = false) => {
    const meu = ++pedidoRef.current;
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/meta/planejamento?mes=${m}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (meu !== pedidoRef.current) return;
      if (!res.ok) throw new Error(data.error || "Não foi possível carregar o planejamento");
      setDados(data as Planejamento);
    } catch (e: any) {
      if (meu === pedidoRef.current) setErro(e.message);
    } finally {
      if (meu === pedidoRef.current) setCarregando(false);
    }
  }, []);

  // Métricas reais vêm da Meta por um sync separado (lento, com trava de 5 min
  // no servidor). A tela abre com o que está no banco e só recarrega se o sync
  // trouxe algo novo — sem segurar o lojista olhando spinner.
  const sincronizar = useCallback(async (forcarRecarga: boolean) => {
    setSincronizando(true);
    try {
      const res = await fetch("/api/meta/planejamento/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (forcarRecarga || (res.ok && Number(data.sincronizadas) > 0)) await carregar(mesRef.current, true);
      if (forcarRecarga && data.puladoPorTrava) setAviso("Números da Meta atualizados há menos de 5 min — mostrando os mais recentes.");
    } catch {
      if (forcarRecarga) await carregar(mesRef.current, true);
    } finally {
      setSincronizando(false);
    }
  }, [carregar]);

  useEffect(() => {
    carregar(mes).then(() => {
      if (syncInicialFeito.current) return;
      syncInicialFeito.current = true;
      sincronizar(false);
    });
  }, [mes, carregar, sincronizar]);

  // Relógio do "atualizado há X min".
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  // Carros disponíveis — pro seletor e pra achar a arte ao editar um rascunho.
  // Colunas explícitas: `veiculos` tem o embedding (vetor pesado), nunca select('*').
  useEffect(() => {
    if (!effectiveUserId) return;
    setCarregandoCarros(true);
    supabase
      .from("veiculos")
      .select(`id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, status_venda, ${COLUNAS_MIDIA}`)
      .eq("user_id", effectiveUserId)
      .eq("status_venda", "DISPONIVEL")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCarros((data as unknown as CarroEstoque[]) ?? []);
        setCarregandoCarros(false);
      });
  }, [effectiveUserId]);

  const campanhas = useMemo(() => {
    const lista = [...(dados?.campanhas ?? [])];
    // Ativos primeiro, sempre (pedido do Lucas 24/09). Dentro do grupo, pela
    // data: o que vai começar (agendado/rascunho) do mais próximo pro mais
    // longe; o resto do mais recente pro mais antigo. Sem data vai pro fim.
    const ORDEM: Record<string, number> = {
      ativo: 0, agendado: 1, publicando: 2, rascunho: 3, pausado: 4, erro: 5, encerrado: 6, cancelado: 7,
    };
    const futuro = (s: string) => s === "agendado" || s === "rascunho" || s === "publicando";
    lista.sort((a, b) => {
      const ga = ORDEM[a.status] ?? 9;
      const gb = ORDEM[b.status] ?? 9;
      if (ga !== gb) return ga - gb;
      const ta = a.inicia_em ? new Date(a.inicia_em).getTime() : null;
      const tb = b.inicia_em ? new Date(b.inicia_em).getTime() : null;
      if (ta == null || tb == null) return ta == null ? (tb == null ? 0 : 1) : -1;
      return futuro(a.status) ? ta - tb : tb - ta;
    });
    return lista;
  }, [dados]);

  const contagem = useMemo(() => {
    const r: Record<string, number> = {};
    for (const f of FILTROS) r[f.id] = campanhas.filter(c => f.casa(c.status)).length;
    return r;
  }, [campanhas]);

  const visiveis = useMemo(() => {
    const f = FILTROS.find(x => x.id === filtro)!;
    return campanhas.filter(c => f.casa(c.status));
  }, [campanhas, filtro]);

  // Linha de TOTAL: soma o que soma; taxas recalculadas dos totais (média de
  // CTR/CPC por linha daria número errado).
  const total = useMemo(() => {
    let gasto = 0, impressoes = 0, alcance = 0, cliques = 0, previsto = 0, resultados = 0;
    for (const c of visiveis) {
      const m = c.metricas ?? {};
      gasto += Number(m.gasto) || 0;
      impressoes += Number(m.impressoes) || 0;
      alcance += Number(m.alcance) || 0;
      cliques += Number(m.cliques) || 0;
      previsto += Number(c.previsto_mes) || 0;
      resultados += Number(resultadoDe(c).n) || 0;
    }
    return {
      gasto, impressoes, alcance, cliques, previsto, resultados,
      cpc: cliques ? gasto / cliques : null,
      ctr: impressoes ? (cliques / impressoes) * 100 : null,
      custo: resultados ? gasto / resultados : null,
    };
  }, [visiveis]);

  // ── Abrir o modal de anúncio ──
  const abrirNovo = (c: CarroEstoque) => {
    const midia = midiaDoVeiculo(c);
    setSeletorAberto(false);
    setModal({
      veiculoId: c.id,
      marca: c.marca ?? "",
      modelo: c.modelo ?? "",
      ano: c.ano_modelo ?? c.ano ?? "",
      fotoUrl: midia.imagemPadrao,
      formatoInicial: melhorFormato(midia),
    });
  };

  const abrirEdicao = (c: CampanhaPlano) => {
    if (!c.veiculo?.id) return;
    const carro = carros.find(x => x.id === c.veiculo!.id);
    const midia = carro ? midiaDoVeiculo(carro) : null;
    // Payload ausente (rascunho gravado antes do backend guardar o body) →
    // monta o que der a partir das colunas, pra edição não zerar a config.
    const payload = c.payload ?? {
      objetivo: c.objetivo, placement: c.placement, formato: c.formato,
      tipoOrcamento: c.tipo_orcamento, orcamentoDiario: c.orcamento_diario,
      orcamentoTotal: c.orcamento_total, duracaoDias: c.duracao_dias,
      semDataFim: c.sem_data_fim ?? undefined, iniciaEm: c.inicia_em,
      idadeMin: c.idade_min, idadeMax: c.idade_max, genero: c.genero,
    };
    setModal({
      veiculoId: c.veiculo.id,
      marca: carro?.marca ?? "",
      modelo: carro?.modelo ?? c.veiculo.nome,
      ano: carro?.ano_modelo ?? carro?.ano ?? "",
      // Carro fora da lista (vendido, p.ex.) ainda tem a thumb da campanha.
      fotoUrl: midia?.imagemPadrao ?? c.veiculo.thumb ?? c.thumb,
      rascunhoId: c.id,
      payload,
    });
  };

  // ── Ações da lista ──
  const executar = async (c: CampanhaPlano, acao: Acao) => {
    const nome = nomeCampanha(c);
    if (acao === "publicar") {
      const { valor, estimado } = valorTotal(c);
      const futuro = c.inicia_em && new Date(c.inicia_em).getTime() > Date.now() + 60_000;
      const ok = confirm(
        `${futuro ? "Agendar" : "Publicar agora"} "${nome}"?\n\n` +
        `Investimento: ${brl(valor)}${estimado ? " (estimativa de 30 dias — roda até pausar)" : ""}\n` +
        `Início: ${c.inicia_em ? dataHora(c.inicia_em) : "agora"}\n\n` +
        `É dinheiro real: a Meta cobra da conta de anúncios da loja.`,
      );
      if (!ok) return;
    }
    if (acao === "excluir" && !confirm(`Excluir o rascunho "${nome}"? Não dá pra desfazer.`)) return;
    if (acao === "ativar" && !confirm(`Reativar "${nome}"? Volta a gastar o orçamento na Meta.`)) return;

    setAcaoEm(c.id);
    setErro(null);
    try {
      let res: Response;
      if (acao === "publicar") {
        res = await fetch(`/api/meta/ads/rascunho/${c.id}/publicar`, { method: "POST" });
      } else if (acao === "excluir") {
        res = await fetch(`/api/meta/ads/rascunho/${c.id}`, { method: "DELETE" });
      } else {
        // Rota de status que já existia: "retomar" é o "ativar" da Meta.
        res = await fetch("/api/meta/ads/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campanhaId: c.id, acao: acao === "pausar" ? "pausar" : "retomar" }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "A ação falhou");
      await carregar(mesRef.current, true);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcaoEm(null);
    }
  };

  // ── Cards do topo ──
  const saldo = dados?.saldo;
  const projetado = dados?.saldoProjetado ?? null;
  const semSaldo = saldo && saldo.disponivel == null;

  return (
    <div className="p-4 md:p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end mb-8">
          <div>
            <Link href="/marketing" className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 mb-3">
              <ArrowLeft size={11} /> Marketing
            </Link>
            <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-300 leading-none mb-2 tracking-tighter">
              Planejamento
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
              Anúncios pagos planejados no Meta Ads
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => sincronizar(true)}
              disabled={sincronizando}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-2xl text-[10px] font-black uppercase tracking-wider hover:border-gray-300 disabled:opacity-60 transition-all"
            >
              <RefreshCw size={14} className={sincronizando ? "animate-spin" : ""} /> Atualizar
            </button>
            <button
              onClick={() => setSeletorAberto(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-all"
            >
              <Plus size={14} /> Adicionar postagem
            </button>
          </div>
        </div>

        {/* Mês + carimbo de atualização */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm">
            <button onClick={() => setMes(m => somarMes(m, -1))} className="p-2 rounded-xl text-gray-400 hover:text-gray-800 hover:bg-gray-50" aria-label="Mês anterior">
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 min-w-[150px] text-center text-[11px] font-black uppercase tracking-widest text-gray-800">
              {rotuloMes(mes)}
            </span>
            <button onClick={() => setMes(m => somarMes(m, 1))} className="p-2 rounded-xl text-gray-400 hover:text-gray-800 hover:bg-gray-50" aria-label="Próximo mês">
              <ChevronRight size={16} />
            </button>
          </div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
            {sincronizando && <Loader2 size={11} className="animate-spin" />}
            {sincronizando ? "Buscando números na Meta…" : dados?.atualizadoEm ? `Atualizado ${haQuanto(dados.atualizadoEm, agora)}` : ""}
          </p>
        </div>

        {aviso && (
          <div className="mb-4 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-[11px] text-blue-700">
            <Info size={14} className="shrink-0" /> {aviso}
          </div>
        )}

        {/* Erro com dados já na tela (ação falhou) — sem apagar a lista */}
        {erro && dados && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700 flex-1">{erro}</p>
            <button onClick={() => setErro(null)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
          </div>
        )}

        {carregando && !dados ? (
          <div className="py-32 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : erro && !dados ? (
          <div className="py-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-red-100">
            <AlertCircle size={28} className="mx-auto text-red-300 mb-3" />
            <p className="text-xs font-black uppercase tracking-widest text-red-400 mb-1">Não deu pra carregar</p>
            <p className="text-[11px] text-gray-400 mb-5">{erro}</p>
            <button onClick={() => carregar(mes)} className="px-5 py-2.5 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600">
              Tentar de novo
            </button>
          </div>
        ) : dados && (
          // Trocando de mês: mantém o mês anterior esmaecido e sem clique (ação
          // em linha velha seria na campanha errada) até a resposta chegar.
          <div className={`transition-opacity ${carregando ? "opacity-50 pointer-events-none" : ""}`}>
            {/* ── 4 cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <CardResumo
                icone={<Wallet size={12} />}
                titulo="Saldo na Meta"
                valor={semSaldo ? (saldo?.texto || "—") : brl(saldo?.disponivel)}
                sub={semSaldo ? null : (
                  <>
                    {saldo?.contaNome && <span className="block truncate">{saldo.contaNome}</span>}
                    {saldo?.prepago === true && "Saldo pré-pago"}
                    {saldo?.prepago === false && "Conta pós-paga (cartão)"}
                  </>
                )}
              >
                {semSaldo && (
                  <div className="mt-3 flex items-start gap-1.5 bg-amber-50 rounded-xl p-2.5 border border-amber-100">
                    <AlertCircle size={11} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[9px] text-amber-700 leading-snug">
                      {saldo?.erro || "Não foi possível ler o saldo."}{" "}
                      <Link href="/configuracoes?tab=portais" className="font-black underline">Conecte/configure a conta de anúncios</Link>.
                    </p>
                  </div>
                )}
              </CardResumo>

              <CardResumo
                icone={<TrendingUp size={12} />}
                titulo="Previsão do mês"
                valor={brl(dados.previsaoMes)}
                sub={`Falta gastar ${brl(dados.aGastarRestante)}`}
              />

              <CardResumo
                icone={<PiggyBank size={12} />}
                titulo="Saldo projetado"
                valor={projetado == null ? "—" : brl(projetado)}
                tom={projetado == null ? "neutro" : projetado < 0 ? "vermelho" : "verde"}
                sub={projetado == null
                  ? "Precisa do saldo da Meta pra projetar"
                  : projetado < 0
                    ? <span className="text-red-600 font-black">Vai faltar {brl(Math.abs(projetado))} — recarregue ou corte orçamento</span>
                    : "Sobra depois do que está planejado"}
              />

              <CardResumo
                icone={<Receipt size={12} />}
                titulo="Gasto no mês"
                valor={brl(dados.gastoMes)}
                sub="Valor real cobrado pela Meta"
              />
            </div>

            {/* ── Filtro ── */}
            <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm w-fit max-w-full overflow-x-auto mb-4">
              {FILTROS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFiltro(f.id)}
                  className={`shrink-0 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                    filtro === f.id ? "bg-gray-900 text-white shadow" : "text-gray-400 hover:text-gray-700"
                  }`}
                >
                  {f.label}
                  {contagem[f.id] > 0 && <span className="ml-1.5 opacity-60">{contagem[f.id]}</span>}
                </button>
              ))}
            </div>

            {/* ── Lista ── */}
            {visiveis.length === 0 ? (
              <div className="py-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100">
                <CalendarDays size={28} className="mx-auto text-gray-200 mb-3" />
                <p className="italic font-black uppercase text-gray-300 tracking-widest text-xs mb-5">
                  {campanhas.length === 0 ? `Nada planejado em ${rotuloMes(mes)}` : "Nenhuma postagem neste filtro"}
                </p>
                {campanhas.length === 0 && (
                  <button
                    onClick={() => setSeletorAberto(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-all"
                  >
                    <Plus size={14} /> Adicionar postagem
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Desktop: tabela no estilo do Gerenciador de Anúncios */}
                <div className="hidden lg:block bg-white rounded-3xl border border-gray-100 shadow-sm overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[8px] font-black uppercase tracking-widest text-gray-400">
                        <th className="px-4 py-3">Anúncio</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Veiculação</th>
                        <th className="px-3 py-3 text-right">Orçamento</th>
                        <th className="px-3 py-3 text-right">Previsto no mês</th>
                        <th className="px-3 py-3 text-right">Gasto</th>
                        <th className="px-3 py-3 text-right">Impressões</th>
                        <th className="px-3 py-3 text-right">Alcance</th>
                        <th className="px-3 py-3 text-right">Cliques</th>
                        <th className="px-3 py-3 text-right">CPC</th>
                        <th className="px-3 py-3 text-right">CTR</th>
                        <th className="px-3 py-3 text-right">Resultados</th>
                        <th className="px-3 py-3 text-right">Custo/result.</th>
                        <th className="px-4 py-3">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="text-[11px] text-gray-700">
                      {visiveis.map(c => {
                        const m = c.metricas ?? {};
                        const r = resultadoDe(c);
                        const fim = fimDe(c);
                        return (
                          <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60 align-middle">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3 min-w-[200px]">
                                <Thumb url={c.thumb ?? c.veiculo?.thumb} />
                                <div className="min-w-0">
                                  <p className="font-black uppercase italic text-gray-900 truncate max-w-[200px]">{nomeCampanha(c)}</p>
                                  <p className="text-[9px] text-gray-400 capitalize truncate max-w-[200px]">{detalheCampanha(c)}</p>
                                  {c.status === "erro" && c.erro_msg && (
                                    <p className="text-[9px] text-red-500 truncate max-w-[200px]" title={c.erro_msg}>{c.erro_msg}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3"><StatusPill c={c} /></td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <p className="font-bold">{c.inicia_em ? dataHora(c.inicia_em) : "—"}</p>
                              <p className="text-[9px] text-gray-400">{fim ? `até ${soData(fim)}` : c.sem_data_fim ? "contínua" : "—"}</p>
                            </td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              {c.tipo_orcamento === "total"
                                ? <><p className="font-bold">{brl(c.orcamento_total, 0)}</p><p className="text-[9px] text-gray-400">total</p></>
                                : <><p className="font-bold">{brl(c.orcamento_diario, 0)}</p><p className="text-[9px] text-gray-400">por dia</p></>}
                            </td>
                            <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{brl(c.previsto_mes)}</td>
                            <td className="px-3 py-3 text-right font-black text-gray-900 whitespace-nowrap">{brl(m.gasto)}</td>
                            <td className="px-3 py-3 text-right">{inteiro(m.impressoes)}</td>
                            <td className="px-3 py-3 text-right">{inteiro(m.alcance)}</td>
                            <td className="px-3 py-3 text-right">{inteiro(m.cliques)}</td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">{brl(m.cpc)}</td>
                            <td className="px-3 py-3 text-right">{pct(m.ctr)}</td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <p className="font-black text-gray-900">{inteiro(r.n)}</p>
                              <p className="text-[9px] text-gray-400">{r.rotulo}</p>
                            </td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">{brl(custoResultado(c))}</td>
                            <td className="px-4 py-3">
                              <BotoesAcao c={c} ocupado={acaoEm === c.id} onAcao={executar} onEditar={abrirEdicao} compacto />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 text-[11px] font-black text-gray-900">
                        <td className="px-4 py-3 text-[9px] uppercase tracking-widest text-gray-500" colSpan={4}>
                          Total · {visiveis.length} {visiveis.length === 1 ? "postagem" : "postagens"}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">{brl(total.previsto)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">{brl(total.gasto)}</td>
                        <td className="px-3 py-3 text-right">{inteiro(total.impressoes)}</td>
                        {/* Alcance somado conta a mesma pessoa em anúncios diferentes — é teto, não único. */}
                        <td className="px-3 py-3 text-right" title="Soma simples: a mesma pessoa pode ter visto mais de um anúncio">{inteiro(total.alcance)}</td>
                        <td className="px-3 py-3 text-right">{inteiro(total.cliques)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">{brl(total.cpc)}</td>
                        <td className="px-3 py-3 text-right">{pct(total.ctr)}</td>
                        <td className="px-3 py-3 text-right">{inteiro(total.resultados)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">{brl(total.custo)}</td>
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Celular: cards empilhados com as mesmas infos */}
                <div className="lg:hidden flex flex-col gap-3">
                  {visiveis.map(c => {
                    const m = c.metricas ?? {};
                    const r = resultadoDe(c);
                    const fim = fimDe(c);
                    return (
                      <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <div className="flex items-start gap-3">
                          <Thumb url={c.thumb ?? c.veiculo?.thumb} lado={56} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-black uppercase italic text-gray-900 truncate">{nomeCampanha(c)}</p>
                            <p className="text-[9px] text-gray-400 capitalize truncate mb-1.5">{detalheCampanha(c)}</p>
                            <StatusPill c={c} />
                          </div>
                        </div>

                        {c.status === "erro" && c.erro_msg && (
                          <p className="mt-3 text-[10px] text-red-600 bg-red-50 rounded-xl p-2.5 leading-snug">{c.erro_msg}</p>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
                          <div className="bg-gray-50 rounded-xl p-2.5">
                            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Veiculação</p>
                            <p className="font-bold text-gray-800 mt-0.5">{c.inicia_em ? dataHora(c.inicia_em) : "—"}</p>
                            <p className="text-gray-400">{fim ? `até ${soData(fim)}` : c.sem_data_fim ? "contínua" : "—"}</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-2.5">
                            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Orçamento</p>
                            <p className="font-bold text-gray-800 mt-0.5">
                              {c.tipo_orcamento === "total" ? `${brl(c.orcamento_total, 0)} total` : `${brl(c.orcamento_diario, 0)}/dia`}
                            </p>
                            <p className="text-gray-400">previsto no mês {brl(c.previsto_mes)}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5 mt-2 text-center">
                          {[
                            { l: "Gasto", v: brl(m.gasto) },
                            { l: "Impressões", v: inteiro(m.impressoes) },
                            { l: "Alcance", v: inteiro(m.alcance) },
                            { l: "Cliques", v: inteiro(m.cliques) },
                            { l: "CPC", v: brl(m.cpc) },
                            { l: "CTR", v: pct(m.ctr) },
                            { l: r.rotulo, v: inteiro(r.n) },
                            { l: "Custo/res.", v: brl(custoResultado(c)) },
                          ].map(k => (
                            <div key={k.l} className="bg-gray-50 rounded-xl py-2 px-1">
                              <p className="text-[11px] font-black text-gray-800 leading-none truncate">{k.v}</p>
                              <p className="text-[7px] font-black uppercase tracking-widest text-gray-400 mt-1 truncate">{k.l}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 pt-3 border-t border-gray-50">
                          <BotoesAcao c={c} ocupado={acaoEm === c.id} onAcao={executar} onEditar={abrirEdicao} />
                        </div>
                      </div>
                    );
                  })}

                  {/* Total no celular */}
                  <div className="bg-gray-900 text-white rounded-2xl p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">
                      Total · {visiveis.length} {visiveis.length === 1 ? "postagem" : "postagens"}
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { l: "Previsto", v: brl(total.previsto) },
                        { l: "Gasto", v: brl(total.gasto) },
                        { l: "Resultados", v: inteiro(total.resultados) },
                        { l: "Cliques", v: inteiro(total.cliques) },
                        { l: "CTR", v: pct(total.ctr) },
                        { l: "Custo/res.", v: brl(total.custo) },
                      ].map(k => (
                        <div key={k.l}>
                          <p className="text-[12px] font-black leading-none">{k.v}</p>
                          <p className="text-[7px] font-black uppercase tracking-widest text-gray-400 mt-1">{k.l}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {seletorAberto && (
        <SeletorCarro
          carros={carros}
          carregando={carregandoCarros}
          onEscolher={abrirNovo}
          onFechar={() => setSeletorAberto(false)}
        />
      )}

      {modal && (
        <PublicarMetaButton
          // key força montar de novo: o estado do modal nasce do payload só no open.
          key={modal.rascunhoId ?? `novo-${modal.veiculoId}`}
          veiculoId={modal.veiculoId}
          marca={modal.marca}
          modelo={modal.modelo}
          ano={modal.ano}
          fotoUrl={modal.fotoUrl}
          formatoInicial={modal.formatoInicial}
          defaultOpen
          modoPlanejamento
          rascunhoId={modal.rascunhoId}
          payloadInicial={modal.payload}
          onClose={() => setModal(null)}
          onSalvo={() => {
            setModal(null);
            carregar(mesRef.current, true);
          }}
        />
      )}
    </div>
  );
}
