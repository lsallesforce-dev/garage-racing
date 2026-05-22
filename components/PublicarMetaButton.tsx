"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, AlertCircle, Facebook, Instagram, X, ChevronDown, MapPin, MessageSquare, Zap, Plus } from "lucide-react";

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
  created_at: string;
  encerra_em: string;
}

interface OpcaoTargeting {
  id: string;
  nome: string;
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

// ─── Listas de targeting ──────────────────────────────────────────────────────

const INTERESSES: OpcaoTargeting[] = [
  { id: "6003200098907", nome: "Automóveis" },
  { id: "6003183645424", nome: "Compra de veículo" },
  { id: "6003208890647", nome: "Carro usado" },
  { id: "6004483778498", nome: "Setor automotivo" },
  { id: "6003139264106", nome: "Concessionárias" },
  { id: "6003172012714", nome: "Financiamento auto" },
  { id: "6002910399551", nome: "SUVs e Pickups" },
];

const COMPORTAMENTOS: OpcaoTargeting[] = [
  { id: "6002714895372", nome: "Compradores carro novo" },
  { id: "6002714898572", nome: "Compradores carro usado" },
  { id: "6002783849748", nome: "Pesquisadores de veículo" },
  { id: "6015235495383", nome: "Usuários app de carros" },
];

const ORCAMENTOS = [10, 15, 30, 50, 100];
const ORCAMENTO_RECOMENDADO = 30;
const DURACOES = [7, 14, 21, 30];
const RAIO_PRESETS = [15, 30, 50, 100, 200, 500];

// Principais cidades brasileiras com coordenadas para geo targeting
interface CidadeBR { nome: string; estado: string; lat: number; lng: number; }
const CIDADES_BR: CidadeBR[] = [
  { nome: "São Paulo",             estado: "SP", lat: -23.5505, lng: -46.6333 },
  { nome: "Rio de Janeiro",        estado: "RJ", lat: -22.9068, lng: -43.1729 },
  { nome: "Brasília",              estado: "DF", lat: -15.7801, lng: -47.9292 },
  { nome: "Salvador",              estado: "BA", lat: -12.9714, lng: -38.5014 },
  { nome: "Fortaleza",             estado: "CE", lat: -3.7172,  lng: -38.5434 },
  { nome: "Belo Horizonte",        estado: "MG", lat: -19.9167, lng: -43.9345 },
  { nome: "Manaus",                estado: "AM", lat: -3.1190,  lng: -60.0217 },
  { nome: "Curitiba",              estado: "PR", lat: -25.4290, lng: -49.2671 },
  { nome: "Recife",                estado: "PE", lat: -8.0539,  lng: -34.8811 },
  { nome: "Porto Alegre",          estado: "RS", lat: -30.0346, lng: -51.2177 },
  { nome: "Belém",                 estado: "PA", lat: -1.4558,  lng: -48.5044 },
  { nome: "Goiânia",               estado: "GO", lat: -16.6864, lng: -49.2643 },
  { nome: "São Luís",              estado: "MA", lat: -2.5297,  lng: -44.3028 },
  { nome: "Maceió",                estado: "AL", lat: -9.6659,  lng: -35.7350 },
  { nome: "Natal",                 estado: "RN", lat: -5.7945,  lng: -35.2110 },
  { nome: "Teresina",              estado: "PI", lat: -5.0892,  lng: -42.8019 },
  { nome: "Campo Grande",          estado: "MS", lat: -20.4697, lng: -54.6201 },
  { nome: "João Pessoa",           estado: "PB", lat: -7.1153,  lng: -34.8641 },
  { nome: "Aracaju",               estado: "SE", lat: -10.9472, lng: -37.0731 },
  { nome: "Cuiabá",                estado: "MT", lat: -15.5961, lng: -56.0969 },
  { nome: "Macapá",                estado: "AP", lat: 0.0349,   lng: -51.0694 },
  { nome: "Porto Velho",           estado: "RO", lat: -8.7612,  lng: -63.9004 },
  { nome: "Boa Vista",             estado: "RR", lat: 2.8235,   lng: -60.6758 },
  { nome: "Palmas",                estado: "TO", lat: -10.2491, lng: -48.3243 },
  { nome: "Rio Branco",            estado: "AC", lat: -9.9754,  lng: -67.8249 },
  { nome: "Florianópolis",         estado: "SC", lat: -27.5954, lng: -48.5480 },
  { nome: "Vitória",               estado: "ES", lat: -20.3155, lng: -40.3128 },
  { nome: "Campinas",              estado: "SP", lat: -22.9056, lng: -47.0608 },
  { nome: "Santos",                estado: "SP", lat: -23.9608, lng: -46.3336 },
  { nome: "Ribeirão Preto",        estado: "SP", lat: -21.1704, lng: -47.8103 },
  { nome: "São José do Rio Preto", estado: "SP", lat: -20.8197, lng: -49.3794 },
  { nome: "Sorocaba",              estado: "SP", lat: -23.5015, lng: -47.4526 },
  { nome: "Osasco",                estado: "SP", lat: -23.5329, lng: -46.7920 },
  { nome: "Santo André",           estado: "SP", lat: -23.6639, lng: -46.5383 },
  { nome: "São Bernardo do Campo", estado: "SP", lat: -23.6914, lng: -46.5646 },
  { nome: "Guarulhos",             estado: "SP", lat: -23.4548, lng: -46.5333 },
  { nome: "Londrina",              estado: "PR", lat: -23.3045, lng: -51.1696 },
  { nome: "Maringá",               estado: "PR", lat: -23.4205, lng: -51.9331 },
  { nome: "Cascavel",              estado: "PR", lat: -24.9578, lng: -53.4595 },
  { nome: "Foz do Iguaçu",        estado: "PR", lat: -25.5469, lng: -54.5882 },
  { nome: "Caxias do Sul",         estado: "RS", lat: -29.1681, lng: -51.1794 },
  { nome: "Pelotas",               estado: "RS", lat: -31.7654, lng: -52.3371 },
  { nome: "Joinville",             estado: "SC", lat: -26.3044, lng: -48.8487 },
  { nome: "Blumenau",              estado: "SC", lat: -26.9194, lng: -49.0661 },
  { nome: "Uberlândia",            estado: "MG", lat: -18.9186, lng: -48.2772 },
  { nome: "Juiz de Fora",          estado: "MG", lat: -21.7600, lng: -43.3496 },
  { nome: "Contagem",              estado: "MG", lat: -19.9317, lng: -44.0536 },
  { nome: "Feira de Santana",      estado: "BA", lat: -12.2664, lng: -38.9663 },
  { nome: "Caruaru",               estado: "PE", lat: -8.2760,  lng: -35.9756 },
  { nome: "Mossoró",               estado: "RN", lat: -5.1875,  lng: -37.3444 },
  { nome: "Imperatriz",            estado: "MA", lat: -5.5256,  lng: -47.4929 },
  { nome: "Anápolis",              estado: "GO", lat: -16.3281, lng: -48.9536 },
  { nome: "Aparecida de Goiânia",  estado: "GO", lat: -16.8234, lng: -49.2437 },
  { nome: "Mogi das Cruzes",       estado: "SP", lat: -23.5228, lng: -46.1875 },
  { nome: "Diadema",               estado: "SP", lat: -23.6860, lng: -46.6228 },
  { nome: "Bauru",                 estado: "SP", lat: -22.3246, lng: -49.0935 },
  { nome: "Piracicaba",            estado: "SP", lat: -22.7253, lng: -47.6492 },
  { nome: "Jundiaí",               estado: "SP", lat: -23.1857, lng: -46.8977 },
  { nome: "Franca",                estado: "SP", lat: -20.5386, lng: -47.4008 },
  { nome: "Marília",               estado: "SP", lat: -22.2157, lng: -49.9458 },
  { nome: "Presidente Prudente",   estado: "SP", lat: -22.1258, lng: -51.3884 },
  { nome: "São Carlos",            estado: "SP", lat: -22.0087, lng: -47.8909 },
  { nome: "Limeira",               estado: "SP", lat: -22.5640, lng: -47.4016 },
  { nome: "Taubaté",               estado: "SP", lat: -23.0264, lng: -45.5553 },
  { nome: "Volta Redonda",         estado: "RJ", lat: -22.5231, lng: -44.1042 },
  { nome: "Niterói",               estado: "RJ", lat: -22.8838, lng: -43.1044 },
  { nome: "Nova Iguaçu",           estado: "RJ", lat: -22.7592, lng: -43.4511 },
  { nome: "Duque de Caxias",       estado: "RJ", lat: -22.7856, lng: -43.3117 },
  { nome: "São Gonçalo",           estado: "RJ", lat: -22.8268, lng: -43.0539 },
  { nome: "Montes Claros",         estado: "MG", lat: -16.7286, lng: -43.8613 },
  { nome: "Uberaba",               estado: "MG", lat: -19.7477, lng: -47.9316 },
  { nome: "Betim",                 estado: "MG", lat: -19.9677, lng: -44.1983 },
  { nome: "Ilhéus",                estado: "BA", lat: -14.7896, lng: -39.0451 },
  { nome: "Vitória da Conquista",  estado: "BA", lat: -14.8661, lng: -40.8444 },
  { nome: "Campina Grande",        estado: "PB", lat: -7.2306,  lng: -35.8817 },
  { nome: "Petrolina",             estado: "PE", lat: -9.3956,  lng: -40.4979 },
  { nome: "Juazeiro do Norte",     estado: "CE", lat: -7.2134,  lng: -39.3152 },
  { nome: "Sobral",                estado: "CE", lat: -3.6882,  lng: -40.3508 },
  { nome: "Santarém",              estado: "PA", lat: -2.4432,  lng: -54.7082 },
  { nome: "Marabá",                estado: "PA", lat: -5.3681,  lng: -49.1178 },
  { nome: "Rondonópolis",          estado: "MT", lat: -16.4726, lng: -54.6358 },
  { nome: "Sinop",                 estado: "MT", lat: -11.8650, lng: -55.5044 },
  { nome: "Cascavel",              estado: "PR", lat: -24.9578, lng: -53.4595 },
  { nome: "Ponta Grossa",          estado: "PR", lat: -25.0945, lng: -50.1633 },
];

// ─── Componente ───────────────────────────────────────────────────────────────

export default function PublicarMetaButton({ veiculoId, marca, modelo, ano, fotoUrl, defaultOpen = false, onClose }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const [paginas, setPaginas]       = useState<Pagina[]>([]);
  const [campanhas, setCampanhas]   = useState<Campanha[]>([]);
  const [loading, setLoading]       = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro]             = useState<string | null>(null);
  const [sucesso, setSucesso]       = useState(false);

  // Configurações básicas
  const [paginaId, setPaginaId]   = useState("");
  const [placement, setPlacement] = useState<"facebook" | "instagram" | "facebook,instagram">("facebook,instagram");
  const [orcamento, setOrcamento] = useState(ORCAMENTO_RECOMENDADO);
  const [duracao, setDuracao]     = useState(7);

  // Localização
  const [cidade, setCidade]                       = useState("");
  const [raio, setRaio]                           = useState(30);
  const [cidadesExtras, setCidadesExtras]         = useState<CidadeBR[]>([]);
  // Busca cidade principal
  const [buscaPrincipal, setBuscaPrincipal]       = useState("");
  const [showDropdownPrincipal, setShowDropdownPrincipal] = useState(false);
  // Busca cidades extras
  const [buscaCidade, setBuscaCidade]             = useState("");
  const [showDropdown, setShowDropdown]           = useState(false);
  const cidadeInputRef                            = useRef<HTMLInputElement>(null);

  // Público-alvo
  const [idadeMin, setIdadeMin]           = useState(25);
  const [idadeMax, setIdadeMax]           = useState(55);
  const [genero, setGenero]               = useState<"todos" | "masculino" | "feminino">("todos");
  const [interesses, setInteresses]       = useState<string[]>([]);
  const [comportamentos, setComportamentos] = useState<string[]>([]);
  const [renda, setRenda]                 = useState<"todos" | "top50" | "top25" | "top10">("todos");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErro(null);

    Promise.all([
      fetch("/api/meta/pagina").then(r => r.json()),
      fetch(`/api/meta/ads?veiculoId=${veiculoId}`).then(r => r.json()).catch(() => ({ campanhas: [] })),
    ]).then(([paginasData, campanhasData]) => {
      if (paginasData.error) { setErro(paginasData.error); return; }
      setPaginas(paginasData.salvas ?? []);
      setCampanhas(campanhasData.campanhas ?? []);
      if (paginasData.salvas?.[0]) setPaginaId(paginasData.salvas[0].id);
      // Carrega cidade das configurações
      if (paginasData.cidade) setCidade(paginasData.cidade);
    }).catch(() => setErro("Erro ao carregar dados"))
      .finally(() => setLoading(false));
  }, [open, veiculoId]);

  const toggleItem = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter(i => i !== id) : [...list, id]);
  };

  const handlePublicar = async () => {
    setPublicando(true);
    setErro(null);
    try {
      const interessesSelecionados = INTERESSES.filter(i => interesses.includes(i.id));
      const comportamentosSelecionados = COMPORTAMENTOS.filter(c => comportamentos.includes(c.id));

      const res = await fetch("/api/meta/ads/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veiculoId,
          paginaId: paginaId || undefined,
          placement,
          orcamentoDiario: orcamento,
          duracaoDias: duracao,
          raioKm: raio,
          idadeMin,
          idadeMax,
          genero,
          interesses: interessesSelecionados,
          comportamentos: comportamentosSelecionados,
          renda,
          cidadesExtras: cidadesExtras.map(c => ({ lat: c.lat, lng: c.lng, nome: c.nome })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar campanha");
      setSucesso(true);
      const updated = await fetch(`/api/meta/ads?veiculoId=${veiculoId}`).then(r => r.json());
      setCampanhas(updated.campanhas ?? []);
      setTimeout(() => setSucesso(false), 3000);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setPublicando(false);
    }
  };

  const totalInvestimento = orcamento * duracao;
  const veiculoNome = [marca, modelo, ano].filter(Boolean).join(" ");
  const campanhasAtivas = campanhas.filter(c => c.status === "ativo");

  return (
    <>
      {/* Botão trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-black text-[11px] uppercase tracking-widest transition-all shadow-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Publicar no Meta
        {campanhasAtivas.length > 0 && (
          <span className="bg-white/20 rounded-full px-1.5 py-0.5 text-[9px]">{campanhasAtivas.length} ativa{campanhasAtivas.length > 1 ? "s" : ""}</span>
        )}
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-3xl z-10">
              <div>
                <p className="font-black text-gray-900 text-sm">Publicar no Meta</p>
                <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{veiculoNome || "Veículo"}</p>
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
              <div className="p-5 space-y-5">

                {/* Campanhas ativas */}
                {campanhasAtivas.length > 0 && (
                  <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-green-700 mb-3">Campanhas ativas</p>
                    {campanhasAtivas.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-600 capitalize">{c.placement.replace(",", " + ")}</span>
                        <div className="flex gap-3 text-gray-500">
                          <span>🎯 {c.leads_gerados} leads</span>
                          <span>💰 R$ {c.gasto_total.toFixed(0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sem página conectada */}
                {paginas.length === 0 && !erro && (
                  <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100 text-center">
                    <p className="text-[12px] font-bold text-orange-700 mb-1">Nenhuma página conectada</p>
                    <p className="text-[11px] text-orange-600">Configure sua Página Facebook em <strong>Configurações → Integração Meta</strong></p>
                  </div>
                )}

                {/* Erro */}
                {erro && (
                  <div className="bg-red-50 rounded-2xl p-4 border border-red-100 flex gap-2">
                    <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-700">{erro}</p>
                  </div>
                )}

                {/* Sucesso */}
                {sucesso && (
                  <div className="bg-green-50 rounded-2xl p-4 border border-green-100 flex gap-2">
                    <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-green-700 font-bold">Campanha criada! Leads chegam automaticamente no WhatsApp.</p>
                  </div>
                )}

                {paginas.length > 0 && (
                  <>
                    {/* Seleção de página */}
                    {paginas.length > 1 && (
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Página</p>
                        <div className="relative">
                          <select
                            value={paginaId}
                            onChange={e => setPaginaId(e.target.value)}
                            className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[12px] text-gray-700 pr-8"
                          >
                            {paginas.map(p => (
                              <option key={p.id} value={p.id}>{p.page_name}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>
                    )}

                    {/* ── ONDE PUBLICAR ──────────────────────────────── */}
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Onde publicar</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["facebook", "instagram", "facebook,instagram"] as const).map(p => (
                          <button
                            key={p}
                            onClick={() => setPlacement(p)}
                            className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all ${
                              placement === p ? "border-blue-500 bg-blue-50" : "border-gray-100 bg-gray-50 hover:border-gray-200"
                            }`}
                          >
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
                    </div>

                    {/* ── LOCALIZAÇÃO ───────────────────────────────── */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <MapPin size={11} className="text-gray-400" />
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Localização</p>
                      </div>

                      {/* Cidade principal */}
                      <div className="mb-3 relative">
                        <p className="text-[9px] text-gray-400 mb-1.5">Cidade principal</p>
                        <input
                          type="text"
                          autoComplete="off"
                          value={buscaPrincipal || cidade}
                          onChange={e => {
                            setBuscaPrincipal(e.target.value);
                            setCidade(e.target.value);
                            setShowDropdownPrincipal(true);
                          }}
                          onFocus={() => { setBuscaPrincipal(cidade); setShowDropdownPrincipal(true); }}
                          onBlur={() => setTimeout(() => { setShowDropdownPrincipal(false); setBuscaPrincipal(""); }, 150)}
                          placeholder="Buscar cidade..."
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[12px] text-gray-700 placeholder-gray-300"
                        />
                        {showDropdownPrincipal && (cidade.length >= 2 || buscaPrincipal.length >= 2) && (() => {
                          const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
                          const q = norm(buscaPrincipal || cidade);
                          const resultados = CIDADES_BR
                            .filter(c => norm(c.nome).includes(q) || norm(c.estado).startsWith(q))
                            .slice(0, 8);
                          return resultados.length > 0 ? (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden">
                              {resultados.map(c => (
                                <button
                                  key={c.nome}
                                  onMouseDown={() => {
                                    setCidade(c.nome);
                                    setBuscaPrincipal("");
                                    setShowDropdownPrincipal(false);
                                  }}
                                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors text-left"
                                >
                                  <span className="text-[12px] text-gray-700 font-medium">{c.nome}</span>
                                  <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-lg">{c.estado}</span>
                                </button>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>

                      {/* Outras cidades */}
                      <div className="mb-4">
                        <p className="text-[9px] text-gray-400 mb-1.5">Adicionar outras cidades</p>

                        {/* Chips das cidades selecionadas */}
                        {cidadesExtras.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {cidadesExtras.map(c => (
                              <span
                                key={c.nome}
                                className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold"
                              >
                                {c.nome} – {c.estado}
                                <button
                                  onClick={() => setCidadesExtras(prev => prev.filter(x => x.nome !== c.nome))}
                                  className="w-4 h-4 flex items-center justify-center hover:bg-blue-200 rounded-full transition-colors"
                                >
                                  <X size={9} />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Input de busca de cidades */}
                        <div className="relative">
                          <input
                            ref={cidadeInputRef}
                            type="text"
                            autoComplete="off"
                            value={buscaCidade}
                            onChange={e => { setBuscaCidade(e.target.value); setShowDropdown(true); }}
                            onFocus={() => setShowDropdown(true)}
                            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                            placeholder="Buscar cidade..."
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 placeholder-gray-300 pr-8"
                          />
                          <Plus size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />

                          {/* Dropdown de resultados */}
                          {showDropdown && buscaCidade.length >= 2 && (() => {
                            const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
                            const q = norm(buscaCidade);
                            const resultados = CIDADES_BR
                              .filter(c =>
                                !cidadesExtras.some(x => x.nome === c.nome) &&
                                c.nome.toLowerCase() !== cidade.toLowerCase() &&
                                (norm(c.nome).includes(q) || norm(c.estado).startsWith(q))
                              )
                              .slice(0, 8);
                            return resultados.length > 0 ? (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden">
                                {resultados.map(c => (
                                  <button
                                    key={c.nome}
                                    onMouseDown={() => {
                                      setCidadesExtras(prev => [...prev, c]);
                                      setBuscaCidade("");
                                      setShowDropdown(false);
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors text-left"
                                  >
                                    <span className="text-[12px] text-gray-700 font-medium">{c.nome}</span>
                                    <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-lg">{c.estado}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null;
                          })()}
                        </div>
                        <p className="text-[9px] text-gray-300 mt-1.5">Cada cidade adiciona um ponto de alcance independente no mapa de entrega do Meta.</p>
                      </div>

                      {/* Raio de alcance */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] text-gray-400">Raio de alcance (por cidade)</p>
                          <p className="text-[13px] font-black text-gray-800">{raio} km</p>
                        </div>

                        {/* Presets de raio */}
                        <div className="flex gap-1 mb-2">
                          {RAIO_PRESETS.map(v => (
                            <button
                              key={v}
                              onClick={() => setRaio(v)}
                              className={`flex-1 py-1.5 rounded-xl text-[9px] font-black transition-all ${
                                raio === v
                                  ? "bg-blue-500 text-white"
                                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                              }`}
                            >
                              {v >= 500 ? "500+" : v}
                            </button>
                          ))}
                        </div>

                        <input
                          type="range" min={5} max={500} step={5} value={raio}
                          onChange={e => setRaio(Number(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                        <div className="flex justify-between text-[9px] text-gray-300 mt-1">
                          <span>5 km</span>
                          <span className="text-gray-400 font-bold">{raio} km selecionado</span>
                          <span>500 km</span>
                        </div>
                      </div>
                    </div>

                    {/* ── PÚBLICO-ALVO ──────────────────────────────── */}
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Público-alvo</p>

                      {/* Faixa etária */}
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
                              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-center"
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[8px] text-gray-400 mb-1">Máxima</p>
                            <input type="number" min={idadeMin + 1} max={65} value={idadeMax}
                              onChange={e => setIdadeMax(Number(e.target.value))}
                              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-center"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Gênero */}
                      <div>
                        <p className="text-[9px] text-gray-500 font-bold mb-1.5">Gênero</p>
                        <div className="flex gap-2">
                          {([
                            { id: "todos",     label: "Todos" },
                            { id: "masculino", label: "Masculino" },
                            { id: "feminino",  label: "Feminino" },
                          ] as const).map(g => (
                            <button
                              key={g.id}
                              onClick={() => setGenero(g.id)}
                              className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all border ${
                                genero === g.id
                                  ? "bg-blue-500 text-white border-blue-500"
                                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              {g.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Interesses */}
                      <div>
                        <p className="text-[9px] text-gray-500 font-bold mb-1.5">Interesses</p>
                        <div className="flex flex-wrap gap-1.5">
                          {INTERESSES.map(item => (
                            <button
                              key={item.id}
                              onClick={() => toggleItem(interesses, setInteresses, item.id)}
                              className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all border ${
                                interesses.includes(item.id)
                                  ? "bg-blue-500 text-white border-blue-500"
                                  : "bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                              }`}
                            >
                              {item.nome}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Comportamento */}
                      <div>
                        <p className="text-[9px] text-gray-500 font-bold mb-1.5">Comportamento</p>
                        <div className="flex flex-wrap gap-1.5">
                          {COMPORTAMENTOS.map(item => (
                            <button
                              key={item.id}
                              onClick={() => toggleItem(comportamentos, setComportamentos, item.id)}
                              className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all border ${
                                comportamentos.includes(item.id)
                                  ? "bg-purple-500 text-white border-purple-500"
                                  : "bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600"
                              }`}
                            >
                              {item.nome}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Renda estimada */}
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <p className="text-[9px] text-gray-500 font-bold">Renda estimada</p>
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded-full text-[8px] font-black uppercase tracking-wide">Em breve</span>
                        </div>
                        <div className="flex gap-1.5">
                          {([
                            { id: "todos", label: "Todos" },
                            { id: "top50", label: "Top 50%" },
                            { id: "top25", label: "Top 25%" },
                            { id: "top10", label: "Top 10%" },
                          ] as const).map(r => (
                            <button
                              key={r.id}
                              disabled
                              onClick={() => setRenda(r.id)}
                              className={`flex-1 py-1.5 rounded-xl text-[9px] font-black transition-all border opacity-50 cursor-not-allowed ${
                                renda === r.id
                                  ? "bg-green-500 text-white border-green-500"
                                  : "bg-white text-gray-500 border-gray-200"
                              }`}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── INVESTIMENTO ──────────────────────────────── */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">R$/dia</p>
                        <div className="flex flex-wrap gap-1">
                          {ORCAMENTOS.map(v => (
                            <button
                              key={v}
                              onClick={() => setOrcamento(v)}
                              className={`relative flex-1 min-w-[36px] py-2 rounded-xl text-[10px] font-black transition-all ${
                                orcamento === v ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                              }`}
                            >
                              {v}
                              {v === ORCAMENTO_RECOMENDADO && (
                                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-green-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full leading-none">
                                  ★ TOP
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                        {orcamento === ORCAMENTO_RECOMENDADO && (
                          <p className="text-[9px] text-green-600 font-bold mt-1.5">✓ Valor recomendado para mais leads</p>
                        )}
                        {orcamento === 10 && (
                          <p className="text-[9px] text-gray-400 mt-1.5">Ideal para testes iniciais</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Duração</p>
                        <div className="flex gap-1">
                          {DURACOES.map(v => (
                            <button key={v} onClick={() => setDuracao(v)}
                              className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${
                                duracao === v ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                              }`}
                            >
                              {v}d
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── RESUMO ────────────────────────────────────── */}
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-1.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Investimento total</span>
                        <span className="font-black text-gray-900">R$ {totalInvestimento.toLocaleString("pt-BR")}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Prazo</span>
                        <span className="font-bold text-gray-700">{duracao} dias</span>
                      </div>
                      {cidade && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-gray-500">Região</span>
                          <span className="font-bold text-gray-700 text-right">
                            {cidade}{cidadesExtras.length > 0 ? ` +${cidadesExtras.length} cidade${cidadesExtras.length > 1 ? "s" : ""}` : ""} · {raio} km
                          </span>
                        </div>
                      )}
                      <div className="h-px bg-gray-200 my-1" />
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-500">Lead responde no</span>
                        <span className="flex items-center gap-1 font-bold text-green-600">
                          <Zap size={11} /> WhatsApp automático
                        </span>
                      </div>
                      <div className="flex items-start gap-2 bg-green-50 rounded-xl p-2.5 mt-1 border border-green-100">
                        <Zap size={12} className="text-green-600 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-green-700 leading-snug">
                          O telefone do anúncio vai direto para o agente IA — cada lead é respondido automaticamente no WhatsApp da loja.
                        </p>
                      </div>
                    </div>

                    {/* ── MENSAGENS DIRECT (segunda fase) ──────────── */}
                    <div className="flex items-center gap-3 bg-indigo-50 rounded-2xl p-3.5 border border-indigo-100">
                      <MessageSquare size={20} className="text-indigo-400 shrink-0" />
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-[11px] font-black text-indigo-700">Mensagens Direct → Chat</p>
                          <span className="px-1.5 py-0.5 bg-indigo-200 text-indigo-600 rounded-full text-[8px] font-black uppercase tracking-wide">Em breve</span>
                        </div>
                        <p className="text-[10px] text-indigo-500 leading-snug">Leads que enviam direct no Instagram também entrarão no chat e serão respondidos pelo agente.</p>
                      </div>
                    </div>

                    {/* ── BOTÃO PUBLICAR ────────────────────────────── */}
                    <button
                      onClick={handlePublicar}
                      disabled={publicando || !fotoUrl}
                      className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-black text-[12px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      {publicando ? (
                        <><Loader2 size={16} className="animate-spin" /> Criando campanha...</>
                      ) : (
                        "Publicar agora"
                      )}
                    </button>

                    {!fotoUrl && (
                      <p className="text-center text-[10px] text-orange-500">Adicione uma foto ao veículo para criar o anúncio</p>
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
