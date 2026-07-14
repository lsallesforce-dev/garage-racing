"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useUserRole } from "@/components/SidebarWrapper";
import { Edit3, Plus, Car, Zap, Search, ArrowRight, Trash2, Share2, Copy, Check, X, Loader2, RotateCcw, Save } from "lucide-react";

export default function ListaEstoque() {
  const { effectiveUserId, isVendedor } = useUserRole();
  const [carros, setCarros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  // Filtros
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroModelo, setFiltroModelo] = useState("");
  const [filtroAno, setFiltroAno] = useState("");
  const [filtroValorMin, setFiltroValorMin] = useState("");
  const [filtroValorMax, setFiltroValorMax] = useState("");

  // Repasse state
  const [repasseCarroId, setRepasseCarroId] = useState<string | null>(null);
  const [repasseTexto, setRepasseTexto] = useState<string>("");
  const [repasseCapaUrl, setRepasseCapaUrl] = useState<string | null>(null);
  const [repasseLoading, setRepasseLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [repasseTipo, setRepasseTipo] = useState<"repasse" | "promocao">("repasse");
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [textoSalvo, setTextoSalvo] = useState(false); // veículo já tem texto congelado

  const handleDelete = async (id: string) => {
    const res = await fetch("/api/veiculo/deletar", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ veiculoId: id }),
    });
    if (res.ok) {
      setCarros(prev => prev.filter(c => c.id !== id));
    }
    setConfirmandoId(null);
  };

  useEffect(() => {
    const buscarEstoque = async () => {
      if (!effectiveUserId) return;
      setLoading(true);
      const { data } = await supabase
        .from('veiculos')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('status_venda', { ascending: true })
        .order('created_at', { ascending: false });
      if (data) setCarros(data);
      setLoading(false);
    };
    buscarEstoque();
  }, [effectiveUserId]);

  const gerarRepasse = async (id: string, tipo: "repasse" | "promocao" = "repasse", forcar = false) => {
    setRepasseTipo(tipo);
    setRepasseCarroId(id);
    setRepasseTexto("");
    setRepasseCapaUrl(null);
    setEnviado(false);
    setSalvo(false);
    setRepasseLoading(true);
    try {
      const res = await fetch("/api/veiculo/gerar-repasse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // forcar=true ignora o texto salvo e regenera do zero (botão ↺)
        body: JSON.stringify({ veiculoId: id, tipo, forcar }),
      });
      const data = await res.json();
      setRepasseTexto(data.texto ?? "");
      setRepasseCapaUrl(data.capaUrl ?? null);
      setTextoSalvo(!!data.salvo); // veio do texto congelado?
    } catch {
      setRepasseTexto("Erro ao gerar. Tente novamente.");
    } finally {
      setRepasseLoading(false);
    }
  };

  // Congela o texto atual no veículo. A partir daí grupo e prospecção usam ELE
  // verbatim, sem regenerar (pedido Marcos: FIPE errada corrigida na mão não
  // pode voltar no envio automático).
  const salvarRepasse = async () => {
    if (!repasseCarroId || !repasseTexto.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/veiculo/patch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: repasseCarroId, fields: { repasse_texto: repasseTexto } }),
      });
      if (res.ok) {
        setSalvo(true);
        setTextoSalvo(true);
        setTimeout(() => setSalvo(false), 3000);
      }
    } finally {
      setSalvando(false);
    }
  };

  const exportarRepasse = async () => {
    if (!repasseCarroId || !repasseTexto) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const res = await fetch("/api/veiculo/enviar-repasse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: repasseCarroId, texto: repasseTexto, capaUrl: repasseCapaUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErroEnvio(data.error || `Erro ${res.status}`);
        return;
      }
      setEnviado(true);
      setTimeout(() => setEnviado(false), 3000);
    } catch (e: any) {
      setErroEnvio("Falha na conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const estornarVenda = async (id: string) => {
    if (!confirm("Estornar a venda? O carro voltará para o estoque como DISPONÍVEL.")) return;
    await fetch("/api/veiculo/patch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        veiculoId: id,
        fields: {
          status_venda: "DISPONIVEL",
          preco_venda_final: null,
          data_venda: null,
          vendedor_id: null,
          cliente_id: null,
        },
      }),
    });
    setCarros(prev => prev.map(c => c.id === id ? { ...c, status_venda: "DISPONIVEL", preco_venda_final: null, data_venda: null } : c));
  };

  const copiarTexto = async () => {
    if (!repasseTexto) return;
    await navigator.clipboard.writeText(repasseTexto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  // Listas únicas para os dropdowns
  const marcasUnicas = [...new Set(carros.map(c => c.marca).filter(Boolean))].sort();
  const anosUnicos = [...new Set(carros.map(c => c.ano_modelo || c.ano_fabricacao).filter(Boolean))].sort((a, b) => b - a);

  // Carros filtrados
  const carrosFiltrados = carros.filter(c => {
    if (filtroMarca && c.marca?.toLowerCase() !== filtroMarca.toLowerCase()) return false;
    if (filtroModelo && !`${c.marca} ${c.modelo} ${c.versao}`.toLowerCase().includes(filtroModelo.toLowerCase())) return false;
    if (filtroAno && String(c.ano_modelo || c.ano_fabricacao) !== filtroAno) return false;
    if (filtroValorMin && (c.preco_sugerido || 0) < Number(filtroValorMin)) return false;
    if (filtroValorMax && (c.preco_sugerido || 0) > Number(filtroValorMax)) return false;
    return true;
  });

  const temFiltro = filtroMarca || filtroModelo || filtroAno || filtroValorMin || filtroValorMax;

  return (
    <div className="p-4 md:p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end mb-6 md:mb-8">
            <div>
                <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-300 leading-none mb-2 tracking-tighter">Estoque Inteligente</h1>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">Gerenciamento completo do pátio digital.</p>
            </div>
            <Link href="/upload" className="self-start sm:self-auto px-6 py-3 md:px-8 md:py-4 bg-red-600 text-white font-black uppercase italic rounded-2xl shadow-xl shadow-red-200 flex items-center gap-2 hover:scale-105 transition-all tracking-widest text-[10px]">
                <Plus size={18} strokeWidth={3} /> Cadastrar Nova Máquina
              </Link>
        </div>

        {/* ── Contadores + Filtros num único card ── */}
        <div className="bg-white rounded-2xl md:rounded-3xl border border-gray-100 shadow-sm mb-6 overflow-hidden">
          {/* Contadores */}
          <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <Car size={15} className="text-emerald-600" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-tight">Em Estoque</p>
                <p className="text-xl font-black italic text-gray-900 leading-none">
                  {loading ? "—" : carros.filter(c => c.status_venda !== 'VENDIDO').length}
                </p>
              </div>
            </div>
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Check size={15} className="text-slate-700" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-tight">Vendidos</p>
                <p className="text-xl font-black italic text-gray-900 leading-none">
                  {loading ? "—" : carros.filter(c => c.status_venda === 'VENDIDO').length}
                </p>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            {/* Marca */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Marca</label>
              <select
                value={filtroMarca}
                onChange={e => setFiltroMarca(e.target.value)}
                className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
              >
                <option value="">Todas</option>
                {marcasUnicas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Modelo */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Modelo</label>
              <input
                type="text"
                value={filtroModelo}
                onChange={e => setFiltroModelo(e.target.value)}
                placeholder="Ex: Onix, T-Cross..."
                className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
              />
            </div>

            {/* Ano */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Ano</label>
              <select
                value={filtroAno}
                onChange={e => setFiltroAno(e.target.value)}
                className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
              >
                <option value="">Todos</option>
                {anosUnicos.map(a => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>

            {/* Valor */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Valor (R$)</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={filtroValorMin}
                  onChange={e => setFiltroValorMin(e.target.value)}
                  placeholder="Mín"
                  className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
                />
                <input
                  type="number"
                  value={filtroValorMax}
                  onChange={e => setFiltroValorMax(e.target.value)}
                  placeholder="Máx"
                  className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Resultado + limpar */}
          {temFiltro && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-50 bg-gray-50/50">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {carrosFiltrados.length} resultado{carrosFiltrados.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => { setFiltroMarca(""); setFiltroModelo(""); setFiltroAno(""); setFiltroValorMin(""); setFiltroValorMax(""); }}
                className="text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-700 transition-colors flex items-center gap-1"
              >
                <X size={11} /> Limpar filtros
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4">
            {!loading ? (
                carrosFiltrados.length > 0 ? carrosFiltrados.map((carro) => (
                <div key={carro.id} className="bg-white p-4 md:p-6 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-sm hover:shadow-xl transition-all group">
                    <div className="flex items-center gap-4">
                    <div className="w-24 h-16 md:w-32 md:h-20 flex-shrink-0 bg-gray-100 rounded-2xl overflow-hidden relative">
                        <img
                            src={carro.capa_marketing_url || (carro.fotos?.[0] || 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop')}
                            alt={carro.modelo}
                            className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-700"
                        />
                        {carro.status_venda === 'VENDIDO' && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <span className="text-[8px] font-black uppercase tracking-widest text-white border border-white/20 px-2 py-1 rounded-md">Vendido</span>
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-base md:text-xl font-black uppercase italic leading-none text-gray-900 group-hover:text-red-600 transition-colors truncate max-w-xs md:max-w-sm mb-1" title={`${carro.marca} ${carro.modelo}`}>{carro.marca} {carro.modelo}</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
                            {carro.versao || 'Configuração Esportiva'} • {carro.ano_modelo || '2024'}
                        </p>
                        <p className="text-[11px] font-black text-slate-900 mt-2 tracking-tighter">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(carro.preco_sugerido || 0)}
                        </p>
                    </div>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                        {confirmandoId === carro.id ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-black uppercase text-gray-500">Tem certeza?</span>
                            <button
                              onClick={() => handleDelete(carro.id)}
                              className="px-4 py-2 bg-red-600 text-white text-[10px] font-black uppercase rounded-xl hover:bg-red-700 transition-all"
                            >Apagar</button>
                            <button
                              onClick={() => setConfirmandoId(null)}
                              className="px-4 py-2 bg-gray-100 text-gray-600 text-[10px] font-black uppercase rounded-xl hover:bg-gray-200 transition-all"
                            >Cancelar</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmandoId(carro.id)}
                            className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {carro.status_venda === "VENDIDO" ? (
                          <button
                            onClick={() => estornarVenda(carro.id)}
                            className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-amber-500 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-amber-600 transition-all tracking-widest shadow-lg shadow-amber-200"
                          >
                            <RotateCcw size={14} /> Estornar Venda
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => gerarRepasse(carro.id, "promocao")}
                              className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-blue-600 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-blue-700 transition-all tracking-widest shadow-lg shadow-blue-200"
                            >
                              <Share2 size={14} /> Envio Whats
                            </button>
                            <button
                              onClick={() => gerarRepasse(carro.id)}
                              className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-green-600 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-green-700 transition-all tracking-widest shadow-lg shadow-green-200"
                            >
                              <Share2 size={14} /> Repasse
                            </button>
                          </>
                        )}
                        <Link
                            href={`/veiculo/${carro.id}`}
                            className="flex items-center gap-2 px-4 py-3 md:px-8 md:py-4 bg-slate-900 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-red-600 transition-all tracking-widest shadow-lg shadow-slate-200"
                        >
                            <Zap size={14} className="fill-white" /> Painel do Carro
                        </Link>
                    </div>
                </div>
                )) : (
                    <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
                      {temFiltro ? "Nenhum veículo encontrado com esses filtros." : "O estoque está vazio. Comece a acelerar!"}
                    </div>
                )
            ) : (
                <div className="py-32 text-center flex flex-col items-center">
                    <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin"></div>
                </div>
            )}
        </div>
      </div>

      {/* Modal Repasse */}
      {repasseCarroId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <div>
                <h2 className="text-xl font-black uppercase italic tracking-tight text-gray-900">
                  {repasseTipo === "repasse" ? "Anúncio de Repasse" : "Envio Direto"}
                </h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">Copie e cole no WhatsApp</p>
              </div>
              <button
                onClick={() => { setRepasseCarroId(null); setRepasseTexto(""); setRepasseCapaUrl(null); }}
                className="p-2 rounded-xl hover:bg-gray-100 transition-all text-gray-400 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            {repasseLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16">
                <Loader2 size={32} className="animate-spin text-green-600" />
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Buscando FIPE e média web...</p>
              </div>
            ) : (
              <>
                {/* Capa */}
                {repasseCapaUrl && (
                  <div className="px-8 pb-4">
                    <img src={repasseCapaUrl} alt="Capa" className="w-full h-48 object-cover rounded-2xl" />
                  </div>
                )}

                {/* Texto */}
                <div className="flex-1 overflow-y-auto px-8 pb-4">
                  <textarea
                    value={repasseTexto}
                    onChange={e => setRepasseTexto(e.target.value)}
                    className="w-full whitespace-pre-wrap font-sans text-sm text-gray-800 bg-gray-50 rounded-2xl p-5 leading-relaxed border border-gray-100 resize-none focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 transition-all"
                    rows={18}
                  />
                </div>

                {/* Actions */}
                <div className="px-8 pb-8 pt-4 flex flex-col gap-3">
                  {erroEnvio && (
                    <p className="text-[11px] font-bold text-red-600 bg-red-50 rounded-xl px-4 py-2 text-center">{erroEnvio}</p>
                  )}
                  <p className={`text-[10px] font-bold text-center rounded-xl px-4 py-2 ${textoSalvo ? "text-green-700 bg-green-50" : "text-amber-700 bg-amber-50"}`}>
                    {textoSalvo
                      ? "✓ Texto fixado — os envios de grupo e prospecção usam exatamente este texto."
                      : "Corrigiu algo (ex: FIPE)? Clique em SALVAR pra fixar — senão o envio automático regenera e volta ao original."}
                  </p>
                  <button
                    onClick={salvarRepasse}
                    disabled={salvando || !repasseTexto.trim()}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-gray-900 text-white font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-black transition-all disabled:opacity-60"
                  >
                    {salvando ? (
                      <><Loader2 size={14} className="animate-spin" /> Salvando...</>
                    ) : salvo ? (
                      <><Check size={14} /> Texto fixado!</>
                    ) : (
                      <><Save size={14} /> Salvar texto (grupo + prospecção)</>
                    )}
                  </button>
                  <div className="flex gap-3">
                  <button
                    onClick={exportarRepasse}
                    disabled={enviando}
                    className="flex-1 flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-green-700 transition-all shadow-lg shadow-green-200 disabled:opacity-60"
                  >
                    {enviando ? (
                      <><Loader2 size={14} className="animate-spin" /> Enviando...</>
                    ) : enviado ? (
                      <><Check size={14} /> Enviado pro seu WhatsApp!</>
                    ) : (
                      <><Share2 size={14} /> Exportar pro WhatsApp</>
                    )}
                  </button>
                  <button
                    onClick={copiarTexto}
                    className="px-5 py-4 bg-gray-100 text-gray-600 font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-gray-200 transition-all flex items-center gap-2"
                  >
                    {copiado ? <Check size={14} /> : <Copy size={14} />}
                    {copiado ? "Copiado" : "Copiar"}
                  </button>
                  <button
                    onClick={() => gerarRepasse(repasseCarroId, repasseTipo, true)}
                    className="px-4 py-4 bg-gray-100 text-gray-400 font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-gray-200 transition-all"
                    title="Regenerar do zero (descarta o texto salvo nesta prévia)"
                  >
                    ↺
                  </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
