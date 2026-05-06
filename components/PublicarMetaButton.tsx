"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Facebook, Instagram, X, ChevronDown } from "lucide-react";

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

interface Props {
  veiculoId: string;
  marca?: string;
  modelo?: string;
  ano?: string | number;
  fotoUrl?: string | null;
}

export default function PublicarMetaButton({ veiculoId, marca, modelo, ano, fotoUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  // Configurações da campanha
  const [paginaId, setPaginaId] = useState("");
  const [placement, setPlacement] = useState<"facebook" | "instagram" | "facebook,instagram">("facebook,instagram");
  const [orcamento, setOrcamento] = useState(30);
  const [duracao, setDuracao] = useState(7);
  const [raio, setRaio] = useState(30);
  const [idadeMin, setIdadeMin] = useState(25);
  const [idadeMax, setIdadeMax] = useState(55);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErro(null);

    Promise.all([
      fetch("/api/meta/pagina").then(r => r.json()),
      fetch(`/api/meta/ads?veiculoId=${veiculoId}`).then(r => r.json()).catch(() => ({ campanhas: [] })),
    ]).then(([paginasData, campanhasData]) => {
      if (paginasData.error) { setErro(paginasData.error); return; }
      // paginas vem do banco (já salvas), não das pages brutas do token
      setPaginas(paginasData.salvas ?? []);
      setCampanhas(campanhasData.campanhas ?? []);
      if (paginasData.salvas?.[0]) setPaginaId(paginasData.salvas[0].id);
    }).catch(() => setErro("Erro ao carregar dados"))
      .finally(() => setLoading(false));
  }, [open, veiculoId]);

  const handlePublicar = async () => {
    setPublicando(true);
    setErro(null);
    try {
      const res = await fetch("/api/meta/ads/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, paginaId: paginaId || undefined, placement, orcamentoDiario: orcamento, duracaoDias: duracao, raioKm: raio, idadeMin, idadeMax }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar campanha");
      setSucesso(true);
      // Recarrega campanhas
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
          <div className="bg-white rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <p className="font-black text-gray-900 text-sm">Publicar no Meta</p>
                <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{veiculoNome || "Veículo"}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
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
                    {/* Página */}
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

                    {/* Placement */}
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Onde publicar</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["facebook", "instagram", "facebook,instagram"] as const).map(p => (
                          <button
                            key={p}
                            onClick={() => setPlacement(p)}
                            className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all ${
                              placement === p
                                ? "border-blue-500 bg-blue-50"
                                : "border-gray-100 bg-gray-50 hover:border-gray-200"
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

                    {/* Raio */}
                    <div>
                      <div className="flex justify-between mb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Raio de alcance</p>
                        <p className="text-[11px] font-black text-gray-700">{raio} km</p>
                      </div>
                      <input
                        type="range" min={5} max={200} step={5} value={raio}
                        onChange={e => setRaio(Number(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                      <div className="flex justify-between text-[9px] text-gray-300 mt-1">
                        <span>5 km</span><span>200 km</span>
                      </div>
                    </div>

                    {/* Idade */}
                    <div>
                      <div className="flex justify-between mb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Faixa etária</p>
                        <p className="text-[11px] font-black text-gray-700">{idadeMin} – {idadeMax} anos</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <p className="text-[9px] text-gray-400 mb-1">Mínima</p>
                          <input type="number" min={18} max={idadeMax - 1} value={idadeMin}
                            onChange={e => setIdadeMin(Number(e.target.value))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-center"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-[9px] text-gray-400 mb-1">Máxima</p>
                          <input type="number" min={idadeMin + 1} max={65} value={idadeMax}
                            onChange={e => setIdadeMax(Number(e.target.value))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-center"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Orçamento + Duração */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">R$/dia</p>
                        <div className="flex gap-1">
                          {[15, 30, 50, 100].map(v => (
                            <button key={v} onClick={() => setOrcamento(v)}
                              className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${
                                orcamento === v ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                              }`}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Duração</p>
                        <div className="flex gap-1">
                          {[7, 14, 21, 30].map(v => (
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

                    {/* Resumo */}
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Investimento total</span>
                        <span className="font-black text-gray-900">
                          R$ {totalInvestimento.toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] mt-1">
                        <span className="text-gray-500">Prazo</span>
                        <span className="font-bold text-gray-700">{duracao} dias</span>
                      </div>
                      <div className="flex justify-between text-[11px] mt-1">
                        <span className="text-gray-500">Lead responde no</span>
                        <span className="font-bold text-green-600">WhatsApp automático ⚡</span>
                      </div>
                    </div>

                    {/* Botão publicar */}
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
