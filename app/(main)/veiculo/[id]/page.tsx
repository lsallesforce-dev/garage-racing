"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import { PhotoGallery } from "@/components/PhotoGallery";
import {
  ArrowLeft, Save, Edit2, X, Check, Video, Plus,
  ChevronDown, ChevronUp, Instagram, Download, Loader2,
} from "lucide-react";
import Link from "next/link";

// ─── Opcionais: lista mestre por categoria ────────────────────────────────────
export const OPCIONAIS_CATEGORIAS: { categoria: string; itens: string[] }[] = [
  {
    categoria: "Segurança",
    itens: [
      "Airbag motorista", "Airbag passageiro", "Airbag lateral", "Airbag de cortina",
      "Freio ABS", "Controle de estabilidade (ESP)", "Controle de tração",
      "Assistente de partida em rampa", "Câmera de ré", "Sensor de ré",
      "Sensor dianteiro", "Alerta de ponto cego", "Alerta de colisão frontal",
      "Frenagem autônoma de emergência", "Alarme", "Trava elétrica",
    ],
  },
  {
    categoria: "Conforto",
    itens: [
      "Ar condicionado", "Ar condicionado dual zone", "Ar quente",
      "Bancos em couro", "Bancos em tecido", "Bancos esportivos",
      "Banco do motorista elétrico", "Banco com ajuste lombar",
      "Volante multifuncional", "Volante com ajuste de altura",
      "Retrovisores elétricos", "Retrovisores com rebatimento elétrico",
      "Vidros elétricos", "Teto solar", "Teto panorâmico",
      "Desembaçador traseiro", "Limpador traseiro",
      "Direção hidráulica", "Direção elétrica",
    ],
  },
  {
    categoria: "Tecnologia",
    itens: [
      "Central multimídia", "Tela touch", "Apple CarPlay", "Android Auto",
      "GPS / Navegação", "Bluetooth", "Entrada USB", "Entrada auxiliar",
      "Cruise control", "Cruise control adaptativo",
      "Chave presencial (keyless)", "Partida por botão (push start)",
      "Carregamento wireless", "Som premium", "Câmera 360°",
    ],
  },
  {
    categoria: "Performance / Mecânica",
    itens: [
      "Tração 4x4", "Tração integral", "Tração dianteira", "Tração traseira",
      "Reduzida", "Diferencial traseiro bloqueável", "Modo off-road",
      "Suspensão a ar", "Freio a disco nas 4 rodas", "Pneus novos",
    ],
  },
  {
    categoria: "Visual / Exterior",
    itens: [
      "Rodas de liga leve", "Faróis de LED", "Faróis de xenônio",
      "Lâmpadas de neblina", "Rack de teto", "Estribo lateral",
      "Capota marítima", "Para-brisa térmico", "Grade cromada",
      "Pintura metálica", "Engate reboque",
    ],
  },
];

// ─── Modal de Opcionais ───────────────────────────────────────────────────────
function OpcionaisModal({
  selecionados,
  onClose,
  onSave,
}: {
  selecionados: string[];
  onClose: () => void;
  onSave: (lista: string[]) => void;
}) {
  const [atual, setAtual] = useState<string[]>(selecionados);

  const toggle = (item: string) => {
    setAtual((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100">
          <div>
            <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">
              Itens do Veículo
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              {atual.length} selecionado{atual.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <X size={14} className="text-gray-600" />
          </button>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1 px-8 py-6 space-y-6">
          {OPCIONAIS_CATEGORIAS.map(({ categoria, itens }) => (
            <div key={categoria}>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-3">
                {categoria}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {itens.map((item) => {
                  const checked = atual.includes(item);
                  return (
                    <label
                      key={item}
                      className={`flex items-center gap-2.5 border rounded-xl px-3 py-2.5 cursor-pointer transition-all select-none ${
                        checked
                          ? "bg-gray-900 border-gray-900 text-white"
                          : "bg-gray-50 border-gray-100 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item)}
                        className="hidden"
                      />
                      {checked && <Check size={11} className="flex-shrink-0" />}
                      <span className="text-[11px] font-bold">{item}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => { onSave(atual); onClose(); }}
            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  children,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center px-8 py-5 hover:bg-gray-50/50 transition-colors"
      >
        <div className="text-left">
          <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">{title}</p>
          {subtitle && (
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {open ? (
          <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
        )}
      </button>
      {open && <div className="px-8 pb-8">{children}</div>}
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function DetalheVeiculo() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [veiculo, setVeiculo] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Título
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [nomeEditado, setNomeEditado] = useState("");

  // Campos estruturados
  const [relatorioIA, setRelatorioIA] = useState("");
  const [salvandoRelatorio, setSalvandoRelatorio] = useState(false);
  const [transcricao, setTranscricao] = useState("");
  const [detalhes, setDetalhes] = useState("");
  const [pontosFortes, setPontosFortes] = useState<string[]>([]);
  const [novoPonto, setNovoPonto] = useState("");
  const [salvandoPontos, setSalvandoPontos] = useState(false);
  const [roteiro, setRoteiro] = useState("");
  const [isGeneratingRoteiro, setIsGeneratingRoteiro] = useState(false);
  const [isExtractingFicha, setIsExtractingFicha] = useState(false);

  // Vendedores
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [vendedorId, setVendedorId] = useState("");

  // Opcionais
  const [opcionais, setOpcionais] = useState<string[]>([]);
  const [showOpcionaisModal, setShowOpcionaisModal] = useState(false);

  // Leads
  const [leadsDoVeiculo, setLeadsDoVeiculo] = useState<any[]>([]);

  // Logo do tenant para marca d'água
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Instagram import
  const [igUrl, setIgUrl] = useState("");
  const [importandoIG, setImportandoIG] = useState(false);
  const [igStatus, setIgStatus] = useState<"idle" | "ok" | "error">("idle");
  const [igMsg, setIgMsg] = useState("");

  // ── Carrega veículo ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    supabase
      .from("veiculos")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          data.preco_sugerido = (data.preco_sugerido || 0) * 100;
          setVeiculo(data);
        }
      });
  }, [id]);

  // ── Sincroniza estados quando dados chegam ───────────────────────────────
  useEffect(() => {
    if (!veiculo) return;
    setNomeEditado(`${veiculo.marca} ${veiculo.modelo}`);
    setRelatorioIA(veiculo.relatorio_ia || veiculo.detalhes_inspecao || "");
    setTranscricao(veiculo.transcricao_vendedor || "");
    setDetalhes(veiculo.detalhes_inspecao || "");
    setPontosFortes(veiculo.pontos_fortes_venda || []);
    setOpcionais(veiculo.opcionais || []);
    setRoteiro(veiculo.roteiro_pitch || "");
    setVendedorId(veiculo.vendedor_responsavel_id || "");
  }, [veiculo]);

  // ── Carrega logo do tenant ───────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("logo_url")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.logo_url) setLogoUrl(data.logo_url);
        });
    });
  }, []);

  // ── Carrega vendedores e leads ───────────────────────────────────────────
  useEffect(() => {
    supabase.from("vendedores").select("id, nome").order("nome").then(({ data }) => {
      if (data) setVendedores(data);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("leads")
      .select("*")
      .eq("veiculo_id", id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (data) setLeadsDoVeiculo(data);
      });
  }, [id]);

  // ── Save helpers ─────────────────────────────────────────────────────────

  const patch = async (fields: Record<string, any>) => {
    const { error } = await supabase
      .from("veiculos")
      .update(fields)
      .eq("id", veiculo.id);
    if (error) throw error;
  };

  const handleSalvarNome = async () => {
    if (!veiculo || !nomeEditado.trim()) return;
    const palavras = nomeEditado.trim().split(/\s+/);
    const novaMarca = palavras[0] || "Marca";
    const novoModelo = palavras.slice(1).join(" ") || "Modelo";
    await patch({ marca: novaMarca, modelo: novoModelo, ia_verificada: true });
    setIsEditingTitle(false);
    setVeiculo((p: any) => ({ ...p, marca: novaMarca, modelo: novoModelo }));
  };

  const handleSalvarRelatorio = async () => {
    if (!veiculo || relatorioIA === veiculo.relatorio_ia) return;
    setSalvandoRelatorio(true);
    try {
      await patch({ relatorio_ia: relatorioIA, ia_verificada: true });
      setVeiculo((p: any) => ({ ...p, relatorio_ia: relatorioIA }));
    } catch {
      setRelatorioIA(veiculo.relatorio_ia || "");
    } finally {
      setSalvandoRelatorio(false);
    }
  };

  const handleSalvarTranscricao = async () => {
    if (!veiculo || transcricao === veiculo.transcricao_vendedor) return;
    await patch({ transcricao_vendedor: transcricao });
    setVeiculo((p: any) => ({ ...p, transcricao_vendedor: transcricao }));
  };

  const handleSalvarDetalhes = async () => {
    if (!veiculo || detalhes === veiculo.detalhes_inspecao) return;
    await patch({ detalhes_inspecao: detalhes });
    setVeiculo((p: any) => ({ ...p, detalhes_inspecao: detalhes }));
  };

  const salvarPontosFortes = async (arr: string[]) => {
    setSalvandoPontos(true);
    try {
      await patch({ pontos_fortes_venda: arr });
      setVeiculo((p: any) => ({ ...p, pontos_fortes_venda: arr }));
    } finally {
      setSalvandoPontos(false);
    }
  };

  const handleAdicionarPonto = async () => {
    const txt = novoPonto.trim();
    if (!txt) return;
    const next = [...pontosFortes, txt];
    setPontosFortes(next);
    setNovoPonto("");
    await salvarPontosFortes(next);
  };

  const handleRemoverPonto = async (i: number) => {
    const next = pontosFortes.filter((_, idx) => idx !== i);
    setPontosFortes(next);
    await salvarPontosFortes(next);
  };

  const handleAssinarVendedor = async (vid: string) => {
    setVendedorId(vid);
    await patch({ vendedor_responsavel_id: vid });
  };

  const handleSave = async () => {
    setIsSaving(true);
    const { error } = await supabase
      .from("veiculos")
      .update({
        preco_sugerido: veiculo.preco_sugerido / 100,
        quilometragem_estimada: veiculo.quilometragem_estimada,
        cor: veiculo.cor,
        parcelas: veiculo.parcelas,
        motor: veiculo.motor,
        combustivel: veiculo.combustivel,
        tipo_banco: veiculo.tipo_banco,
        estado_pneus: veiculo.estado_pneus,
        segundo_dono: veiculo.segundo_dono,
        final_placa: veiculo.final_placa,
        vistoriado: veiculo.vistoriado,
        abaixo_fipe: veiculo.abaixo_fipe,
        de_repasse: veiculo.de_repasse,
      })
      .eq("id", id);
    if (!error) alert("Dados atualizados! 🚀");
    setIsSaving(false);
  };

  const handleMarcarVendido = async () => {
    if (!veiculo) return;
    if (!confirm("Confirmar venda desta máquina?")) return;
    setIsSaving(true);
    try {
      const resp = await fetch("/api/veiculo/vender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: veiculo.id }),
      });
      const data = await resp.json();
      if (data.success) {
        alert(`🔥 VENDA REGISTRADA! ${data.notifiedCount} leads notificados.`);
        router.push("/");
      } else throw new Error(data.error);
    } catch (e: any) {
      alert("Falha ao registrar venda: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExtrairFicha = async () => {
    if (!veiculo) return;
    setIsExtractingFicha(true);
    try {
      const resp = await fetch("/api/veiculo/extrair-ficha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: veiculo.id }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error);
      // Atualiza o estado local com os campos extraídos
      setVeiculo((prev: any) => ({ ...prev, ...data.campos }));
    } catch (e: any) {
      alert("Falha ao extrair: " + e.message);
    } finally {
      setIsExtractingFicha(false);
    }
  };

  const handleGerarRoteiro = async () => {
    if (!veiculo) return;
    setIsGeneratingRoteiro(true);
    try {
      const resp = await fetch("/api/veiculo/roteiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: veiculo.id }),
      });
      const data = await resp.json();
      if (data.success) setRoteiro(data.roteiro);
      else throw new Error(data.error);
    } catch (e: any) {
      alert("Falha ao gerar roteiro: " + e.message);
    } finally {
      setIsGeneratingRoteiro(false);
    }
  };

  const handleImportarIG = async () => {
    if (!igUrl.trim() || !veiculo) return;
    setImportandoIG(true);
    setIgStatus("idle");
    setIgMsg("");
    try {
      const res = await fetch("/api/tools/ig-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: igUrl.trim(), veiculoId: veiculo.id }),
      });
      const data = await res.json();
      if (data.success) {
        setIgStatus("ok");
        setIgMsg("Vídeo importado e vinculado ao veículo!");
        setVeiculo((p: any) => ({ ...p, video_url: data.url }));
        setIgUrl("");
      } else {
        throw new Error(data.error || "Falha desconhecida");
      }
    } catch (e: any) {
      setIgStatus("error");
      setIgMsg(e.message);
    } finally {
      setImportandoIG(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!veiculo)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400 font-bold uppercase tracking-widest text-xs">
          Carregando estoque...
        </div>
      </div>
    );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 p-10 overflow-y-auto bg-[#f4f4f2]">
      <div className="max-w-5xl mx-auto">

        {/* ── HEADER ── */}
        <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <Link
              href="/"
              className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-6 hover:text-red-600 transition-colors"
            >
              <ArrowLeft size={12} /> Voltar ao Pátio
            </Link>

            {/* Título editável */}
            <div className="flex items-center gap-4 group">
              {isEditingTitle ? (
                <div className="flex items-center gap-3 w-full max-w-2xl bg-white p-2 rounded-2xl border border-gray-100 shadow-xl">
                  <input
                    type="text"
                    value={nomeEditado}
                    onChange={(e) => setNomeEditado(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSalvarNome()}
                    className="flex-1 bg-transparent text-3xl font-black uppercase tracking-tighter italic outline-none text-gray-900 px-4"
                    autoFocus
                  />
                  <div className="flex gap-1 pr-2">
                    <button
                      onClick={handleSalvarNome}
                      className="p-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-all"
                    >
                      <Check size={20} />
                    </button>
                    <button
                      onClick={() => setIsEditingTitle(false)}
                      className="p-3 bg-gray-100 text-gray-400 rounded-xl hover:text-gray-900 transition-all"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-5xl font-black uppercase tracking-tighter italic text-gray-900 leading-none">
                    {veiculo.marca} {veiculo.modelo}
                  </h1>
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="p-3 bg-gray-50 text-gray-300 hover:text-red-600 rounded-xl transition-all shadow-sm opacity-0 group-hover:opacity-100"
                  >
                    <Edit2 size={18} />
                  </button>
                </>
              )}
            </div>

            <p className="text-red-600 font-bold tracking-[0.3em] uppercase mt-4 text-xs flex items-center gap-2 italic">
              {veiculo.versao} • {veiculo.ano_modelo}
              {veiculo.ia_verificada && (
                <span className="bg-green-100 text-green-600 text-[8px] px-2 py-0.5 rounded-full font-black not-italic">
                  Verificado
                </span>
              )}
            </p>

            {/* Vendedor responsável */}
            <div className="mt-6 flex items-center gap-4 bg-white/50 p-4 rounded-[1.5rem] border border-gray-100 w-fit shadow-sm">
              <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-1">
                  Vendedor Responsável
                </span>
                <select
                  value={vendedorId}
                  onChange={(e) => handleAssinarVendedor(e.target.value)}
                  className="bg-transparent text-[11px] font-black uppercase tracking-widest text-red-600 outline-none cursor-pointer hover:text-black transition-colors"
                >
                  <option value="">Aguardando Atribuição...</option>
                  {vendedores.map((v) => (
                    <option key={v.id} value={v.id} className="text-slate-900 font-sans">
                      {v.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`w-2 h-2 rounded-full ${vendedorId ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
            </div>
          </div>

          <div className="flex gap-4 flex-wrap">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-8 py-4 bg-slate-900 text-white font-black uppercase italic rounded-3xl hover:bg-slate-800 transition-all shadow-xl disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? "Salvando..." : <><Save size={20} /> Salvar</>}
            </button>
          </div>
        </header>

        {/* ── BODY ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

          {/* ── COLUNA ESQUERDA (2/3) ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Galeria */}
            <PhotoGallery
              veiculoId={veiculo.id}
              fotos={veiculo.fotos}
              logoUrl={logoUrl}
              onPhotosUpdated={(newPhotos) =>
                setVeiculo({ ...veiculo, fotos: newPhotos })
              }
            />

            {/* ── IMPORTAR DO INSTAGRAM ── */}
            <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
                  <Instagram size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase italic tracking-tight text-gray-900">
                    Importar do Instagram
                  </h3>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                    Cole a URL de um Reel ou post público
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <input
                  type="url"
                  value={igUrl}
                  onChange={(e) => {
                    setIgUrl(e.target.value);
                    setIgStatus("idle");
                  }}
                  placeholder="https://www.instagram.com/reel/XXXXXX/"
                  className="flex-1 bg-gray-50 rounded-2xl border border-gray-100 px-5 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-300 outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-400/10 transition-all"
                />
                <button
                  onClick={handleImportarIG}
                  disabled={importandoIG || !igUrl.trim()}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-black uppercase rounded-2xl hover:opacity-90 transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {importandoIG ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  {importandoIG ? "Importando..." : "Importar"}
                </button>
              </div>

              {igStatus !== "idle" && (
                <p className={`mt-3 text-[10px] font-black uppercase tracking-widest ${igStatus === "ok" ? "text-green-600" : "text-red-600"}`}>
                  {igStatus === "ok" ? "✓" : "✗"} {igMsg}
                </p>
              )}

              {veiculo.video_url && (
                <div className="mt-4 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-3">
                    Vídeo vinculado ao veículo
                  </p>
                  <video
                    src={veiculo.video_url}
                    controls
                    className="w-full rounded-xl max-h-48 object-cover"
                  />
                </div>
              )}
            </div>

            {/* ── PAINEL DE EDIÇÃO ESTRUTURADO ── */}

            {/* Pontos Fortes de Venda */}
            <SectionCard
              title="Pontos Fortes de Venda"
              subtitle="Chips enviados ao Lucas (IA) em cada atendimento"
            >
              <div className="flex flex-wrap gap-2 mb-4">
                {pontosFortes.map((ponto, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider"
                  >
                    {ponto}
                    <button
                      onClick={() => handleRemoverPonto(i)}
                      className="ml-1 text-white/50 hover:text-white transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {pontosFortes.length === 0 && !salvandoPontos && (
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest italic">
                    Nenhum ponto cadastrado ainda
                  </p>
                )}
                {salvandoPontos && (
                  <span className="text-[9px] text-red-600 font-black uppercase animate-pulse">
                    Salvando...
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={novoPonto}
                  onChange={(e) => setNovoPonto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdicionarPonto();
                    }
                  }}
                  placeholder="Ex: IPVA 2026 pago · Enter para adicionar"
                  className="flex-1 bg-gray-50 rounded-2xl border border-dashed border-gray-200 focus:border-red-600 px-5 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-300 outline-none focus:ring-2 focus:ring-red-600/10 transition-all"
                />
                <button
                  onClick={handleAdicionarPonto}
                  disabled={!novoPonto.trim() || salvandoPontos}
                  className="w-11 h-11 bg-red-600 text-white rounded-2xl flex items-center justify-center hover:bg-red-700 transition-all disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </div>
            </SectionCard>

            {/* Transcrição do Vendedor */}
            <SectionCard
              title="Transcrição do Vendedor"
              subtitle="O que foi dito no vídeo de análise"
              defaultOpen={false}
            >
              <textarea
                value={transcricao}
                onChange={(e) => setTranscricao(e.target.value)}
                onBlur={handleSalvarTranscricao}
                rows={6}
                placeholder="Transcrição automática do vídeo aparece aqui..."
                className="w-full p-5 bg-gray-50 rounded-[1.5rem] border border-gray-100 text-sm leading-relaxed text-gray-700 outline-none focus:ring-4 focus:ring-red-500/5 resize-none font-medium transition-all"
              />
              <p className="mt-2 text-[9px] text-gray-400 italic">
                Salvo automaticamente ao sair do campo.
              </p>
            </SectionCard>

            {/* Detalhes de Inspeção */}
            <SectionCard
              title="Detalhes de Inspeção"
              subtitle="Análise técnica extraída pela IA"
              defaultOpen={false}
            >
              <textarea
                value={detalhes}
                onChange={(e) => setDetalhes(e.target.value)}
                onBlur={handleSalvarDetalhes}
                rows={6}
                placeholder="Detalhes técnicos e inspeção do veículo..."
                className="w-full p-5 bg-gray-50 rounded-[1.5rem] border border-gray-100 text-sm leading-relaxed text-gray-700 outline-none focus:ring-4 focus:ring-red-500/5 resize-none font-medium transition-all"
              />
              <p className="mt-2 text-[9px] text-gray-400 italic">
                Salvo automaticamente ao sair do campo.
              </p>
            </SectionCard>

            {/* Base de Conhecimento da IA */}
            <SectionCard
              title="Base de Conhecimento da IA"
              subtitle="Este texto alimenta o Lucas no WhatsApp — campo mestre"
            >
              <div className="flex justify-between items-center mb-4">
                {salvandoRelatorio && (
                  <span className="text-[10px] font-bold text-red-600 animate-pulse ml-auto">
                    SALVANDO...
                  </span>
                )}
              </div>
              <textarea
                value={relatorioIA}
                onChange={(e) => setRelatorioIA(e.target.value)}
                onBlur={handleSalvarRelatorio}
                rows={10}
                className="w-full p-6 bg-gray-50 rounded-[2rem] border border-gray-100 text-sm leading-relaxed text-gray-600 outline-none focus:ring-4 focus:ring-red-500/5 resize-none font-medium shadow-inner transition-all"
                placeholder="Relatório mestre da IA aparece aqui após análise do vídeo..."
              />
              <p className="mt-3 text-[9px] text-gray-400 italic">
                Dica: adicione acessórios, revisões ou detalhes que o vídeo não mostrou.
              </p>

              {/* Campos estruturados da ficha */}
              <div className="mt-6 flex items-center justify-between mb-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                  Ficha Técnica
                </p>
                <button
                  onClick={handleExtrairFicha}
                  disabled={isExtractingFicha}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-colors"
                >
                  {isExtractingFicha ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : null}
                  {isExtractingFicha ? "Extraindo..." : "⚡ Extrair da IA"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Valor", field: "preco_sugerido", format: (v: any) => v ? `R$ ${Number(v/100).toLocaleString("pt-BR")}` : "" },
                  { label: "Ano", field: "ano", format: (v: any) => v || "" },
                  { label: "Ano Modelo", field: "ano_modelo", format: (v: any) => v || "" },
                  { label: "Modelo", field: "modelo", format: (v: any) => v || "" },
                  { label: "Quilometragem", field: "quilometragem_estimada", format: (v: any) => v ? `${Number(v).toLocaleString("pt-BR")} km` : "" },
                  { label: "Cor", field: "cor", format: (v: any) => v || "" },
                  { label: "Combustível", field: "combustivel", format: (v: any) => v || "" },
                  { label: "Motor", field: "motor", format: (v: any) => v || "" },
                  { label: "Categoria", field: "categoria", format: (v: any) => v || "" },
                  { label: "Tipo de Banco", field: "tipo_banco", format: (v: any) => v || "" },
                  { label: "Estado dos Pneus", field: "estado_pneus", format: (v: any) => v || "" },
                  { label: "Final da Placa", field: "final_placa", format: (v: any) => v || "" },
                  { label: "Segundo Dono", field: "segundo_dono", format: (v: any) => v === true ? "Sim" : v === false ? "Não" : "" },
                ].map(({ label, field, format }) => (
                  <div key={field}>
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</p>
                    <input
                      type="text"
                      key={`${field}-${veiculo?.[field]}`}
                      defaultValue={format(veiculo?.[field])}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (field === "segundo_dono") {
                          patch({ segundo_dono: val.toLowerCase() === "sim" });
                        } else if (field === "preco_sugerido") {
                          // readonly, editado no campo dedicado
                        } else {
                          patch({ [field]: val || null });
                        }
                      }}
                      readOnly={field === "preco_sugerido"}
                      className={`w-full text-[11px] font-bold text-gray-700 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-300 transition-all ${field === "preco_sugerido" ? "opacity-60 cursor-default" : ""}`}
                      placeholder={`${label}...`}
                    />
                  </div>
                ))}

                {/* Opcionais */}
                <div className="col-span-full pt-4 border-t border-gray-100">
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-3">
                    Itens do Veículo
                  </p>
                  {opcionais.length > 0 ? (
                    <div className="grid grid-cols-2 gap-1.5 mb-3">
                      {opcionais.map((item) => (
                        <div
                          key={item}
                          className="text-[10px] font-bold text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 truncate"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest italic mb-3">
                      Nenhum item selecionado
                    </p>
                  )}
                  <button
                    onClick={() => setShowOpcionaisModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-gray-300 hover:border-gray-900 hover:bg-gray-900 hover:text-white text-gray-500 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all"
                  >
                    <Plus size={10} />
                    Opcionais
                  </button>
                </div>

                {/* Selos da vitrine */}
                <div className="col-span-full pt-4 border-t border-gray-100">
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-3">Selos da Vitrine</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { field: "segundo_dono_inv",  label: "Único Dono",        color: "bg-blue-50 border-blue-200 text-blue-700" },
                      { field: "vistoriado",         label: "Vistoriado",        color: "bg-green-50 border-green-200 text-green-700" },
                      { field: "vistoria_cautelar",  label: "Vistoria Cautelar", color: "bg-teal-50 border-teal-200 text-teal-700" },
                      { field: "abaixo_fipe",        label: "Abaixo FIPE",       color: "bg-orange-50 border-orange-200 text-orange-700" },
                      { field: "de_repasse",         label: "De Repasse",        color: "bg-purple-50 border-purple-200 text-purple-700" },
                    ] as { field: string; label: string; color: string }[]).map(({ field, label, color }) => {
                      const checked = field === "segundo_dono_inv"
                        ? veiculo?.segundo_dono === false
                        : veiculo?.[field] === true;
                      return (
                        <label key={field} className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 cursor-pointer transition-all ${color}`}>
                          <input
                            type="checkbox"
                            checked={checked ?? false}
                            onChange={(e) => {
                              if (field === "segundo_dono_inv") {
                                const val = e.target.checked ? false : null;
                                patch({ segundo_dono: val });
                                setVeiculo((p: any) => ({ ...p, segundo_dono: val }));
                              } else {
                                const val = e.target.checked ? true : null;
                                patch({ [field]: val });
                                setVeiculo((p: any) => ({ ...p, [field]: val }));
                              }
                            }}
                            className="w-3.5 h-3.5 accent-current"
                          />
                          <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* ── COLUNA DIREITA (1/3) ── */}
          <div className="space-y-6">

            {/* Preço, KM, Cor, Parcelas */}
            <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8">
              {/* Preço */}
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-4">
                  Preço de Venda
                </label>
                <div className="relative">
                  <span className="absolute left-0 bottom-2 text-gray-300 font-mono font-bold text-xl">R$</span>
                  <input
                    type="text"
                    value={
                      !veiculo.preco_sugerido
                        ? ""
                        : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(
                            veiculo.preco_sugerido / 100
                          )
                    }
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      setVeiculo({ ...veiculo, preco_sugerido: raw === "" ? 0 : Number(raw) });
                    }}
                    className="w-full bg-transparent text-4xl font-mono font-black border-b border-gray-100 focus:border-red-600 outline-none pb-2 pl-10 transition-all text-gray-900"
                  />
                </div>
              </div>

              {/* Quilometragem */}
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-4">
                  Quilometragem
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={
                      !veiculo.quilometragem_estimada
                        ? ""
                        : new Intl.NumberFormat("pt-BR").format(veiculo.quilometragem_estimada)
                    }
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      setVeiculo({ ...veiculo, quilometragem_estimada: raw === "" ? 0 : Number(raw) });
                    }}
                    className="w-full bg-transparent text-4xl font-mono font-black border-b border-gray-100 focus:border-red-600 outline-none pb-2 transition-all text-gray-900"
                  />
                  <span className="absolute right-0 bottom-2 text-gray-300 font-mono font-bold text-xl">KM</span>
                </div>
              </div>

              {/* Cor + Parcelas */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-2">
                    Cor
                  </label>
                  <input
                    type="text"
                    value={veiculo.cor || ""}
                    onChange={(e) => setVeiculo({ ...veiculo, cor: e.target.value })}
                    placeholder="Ex: Prata"
                    className="w-full bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 text-sm font-bold text-gray-900 placeholder:text-gray-300 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/10 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-2">
                    Parcelas
                  </label>
                  <input
                    type="text"
                    value={veiculo.parcelas || ""}
                    onChange={(e) => setVeiculo({ ...veiculo, parcelas: e.target.value })}
                    placeholder="Ex: 48x R$ 1.200"
                    className="w-full bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 text-sm font-bold text-gray-900 placeholder:text-gray-300 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/10 transition-all"
                  />
                </div>
              </div>

              {/* Combustível + Câmbio */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Combustível</p>
                  <p className="text-xs font-black text-gray-900 uppercase">{veiculo.combustivel || "—"}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Câmbio</p>
                  <p className="text-xs font-black text-gray-900 uppercase">{veiculo.cambio || "Automático"}</p>
                </div>
              </div>
            </div>

            {/* Marketing AI Factory */}
            <div className="p-8 bg-[#e2e2de] rounded-[2.5rem] border border-black/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/5 blur-3xl rounded-full -mr-16 -mt-16" />
              <div className="flex justify-between items-center mb-4 relative z-10">
                <h3 className="text-lg font-black uppercase italic tracking-tighter text-gray-900">
                  Marketing AI
                </h3>
                <span className="px-3 py-1 bg-red-600 text-white text-[9px] font-black rounded-full uppercase">
                  Factory
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-6 leading-relaxed relative z-10">
                Pitch matador para Reels e TikTok gerado em segundos.
              </p>
              <button
                onClick={handleGerarRoteiro}
                disabled={isGeneratingRoteiro}
                className="w-full py-4 bg-gray-900 text-white font-black uppercase italic rounded-2xl hover:bg-red-600 transition-all flex items-center justify-center gap-2 relative z-10 disabled:opacity-50"
              >
                {isGeneratingRoteiro ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Video size={18} />
                )}
                {isGeneratingRoteiro ? "Roteirizando..." : "Gerar Pitch de Venda"}
              </button>

              {roteiro && (
                <div className="mt-6 p-5 bg-gray-50 rounded-2xl border border-gray-100 relative z-10">
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-3">
                    Roteiro (Reels/TikTok)
                  </p>
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed italic">
                    {roteiro}
                  </pre>
                </div>
              )}
            </div>

            {/* Leads interessados */}
            <div>
              <h3 className="text-lg font-black uppercase italic mb-4 text-gray-900">
                Leads de Olho nesta Máquina
              </h3>
              <div className="grid gap-3">
                {leadsDoVeiculo.length > 0 ? (
                  leadsDoVeiculo.map((lead) => (
                    <div
                      key={lead.id}
                      className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              lead.status === "QUENTE"
                                ? "bg-red-500 animate-pulse"
                                : lead.status === "MORNO"
                                ? "bg-amber-400"
                                : "bg-blue-400"
                            }`}
                          />
                          <div>
                            <p className="font-black uppercase text-sm leading-none">
                              {lead.nome || "Cliente Interessado"}
                            </p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                              {lead.status || "FRIO"}
                            </p>
                          </div>
                        </div>
                        <a
                          href={`https://wa.me/${lead.wa_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-slate-900 text-white text-[9px] font-black uppercase rounded-xl hover:bg-red-600 transition-colors"
                        >
                          Assumir
                        </a>
                      </div>
                      {lead.resumo_negociacao && (
                        <p className="mt-3 pt-3 border-t border-gray-50 text-[11px] text-gray-500 font-medium italic leading-relaxed">
                          {lead.resumo_negociacao}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="bg-gray-50/50 p-8 rounded-3xl border-2 border-dashed border-gray-100 text-center">
                    <p className="text-sm text-gray-400 italic">
                      Nenhum lead conversando sobre este veículo...
                    </p>
                    <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mt-2">
                      O Lucas (IA) está pronto para atender!
                    </p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Modal de Opcionais */}
      {showOpcionaisModal && (
        <OpcionaisModal
          selecionados={opcionais}
          onClose={() => setShowOpcionaisModal(false)}
          onSave={async (lista) => {
            setOpcionais(lista);
            setVeiculo((p: any) => ({ ...p, opcionais: lista }));
            await patch({ opcionais: lista });
          }}
        />
      )}
    </main>
  );
}
