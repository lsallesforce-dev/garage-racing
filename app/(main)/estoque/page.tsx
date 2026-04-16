"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useUserRole } from "@/components/SidebarWrapper";
import { Edit3, Plus, Car, Zap, Search, ArrowRight, Trash2, Share2, Copy, Check, X, Loader2 } from "lucide-react";

export default function ListaEstoque() {
  const { effectiveUserId, isVendedor } = useUserRole();
  const [carros, setCarros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  // Repasse state
  const [repasseCarroId, setRepasseCarroId] = useState<string | null>(null);
  const [repasseTexto, setRepasseTexto] = useState<string>("");
  const [repasseCapaUrl, setRepasseCapaUrl] = useState<string | null>(null);
  const [repasseLoading, setRepasseLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const handleDelete = async (id: string) => {
    await supabase.from("vendas_concluidas").update({ veiculo_id: null }).eq("veiculo_id", id);
    await supabase.from("leads").update({ veiculo_id: null }).eq("veiculo_id", id);
    await supabase.from("veiculos").delete().eq("id", id);
    setCarros(prev => prev.filter(c => c.id !== id));
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

  const gerarRepasse = async (id: string) => {
    setRepasseCarroId(id);
    setRepasseTexto("");
    setRepasseCapaUrl(null);
    setEnviado(false);
    setRepasseLoading(true);
    try {
      const res = await fetch("/api/veiculo/gerar-repasse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id }),
      });
      const data = await res.json();
      setRepasseTexto(data.texto ?? "");
      setRepasseCapaUrl(data.capaUrl ?? null);
    } catch {
      setRepasseTexto("Erro ao gerar repasse. Tente novamente.");
    } finally {
      setRepasseLoading(false);
    }
  };

  const exportarRepasse = async () => {
    if (!repasseCarroId || !repasseTexto) return;
    setEnviando(true);
    try {
      await fetch("/api/veiculo/enviar-repasse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: repasseCarroId, texto: repasseTexto, capaUrl: repasseCapaUrl }),
      });
      setEnviado(true);
      setTimeout(() => setEnviado(false), 3000);
    } finally {
      setEnviando(false);
    }
  };

  const copiarTexto = async () => {
    if (!repasseTexto) return;
    await navigator.clipboard.writeText(repasseTexto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-end mb-12">
            <div>
                <h1 className="text-6xl font-black italic uppercase text-gray-300 leading-none mb-2 tracking-tighter">Estoque Inteligente</h1>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">Gerenciamento completo do pátio digital.</p>
            </div>
            <Link href="/upload" className="px-8 py-4 bg-red-600 text-white font-black uppercase italic rounded-2xl shadow-xl shadow-red-200 flex items-center gap-2 hover:scale-105 transition-all tracking-widest text-[10px]">
                <Plus size={18} strokeWidth={3} /> Cadastrar Nova Máquina
              </Link>
        </div>

        <div className="grid gap-4">
            {!loading ? (
                carros.length > 0 ? carros.map((carro) => (
                <div key={carro.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 flex items-center justify-between shadow-sm hover:shadow-xl transition-all group">
                    <div className="flex items-center gap-6">
                    <div className="w-32 h-20 bg-gray-100 rounded-2xl overflow-hidden relative">
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
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-xl font-black uppercase italic leading-none text-gray-900 group-hover:text-red-600 transition-colors">{carro.marca} {carro.modelo}</h3>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            {carro.versao || 'Configuração Esportiva'} • {carro.ano_modelo || '2024'}
                        </p>
                        <p className="text-[11px] font-black text-slate-900 mt-2 tracking-tighter">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(carro.preco_sugerido || 0)}
                        </p>
                    </div>
                    </div>

                    <div className="flex gap-3 items-center">
                        {confirmandoId === carro.id ? (
                          <div className="flex items-center gap-2">
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
                        <button
                            onClick={() => gerarRepasse(carro.id)}
                            className="flex items-center gap-2 px-6 py-4 bg-green-600 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-green-700 transition-all tracking-widest shadow-lg shadow-green-200"
                        >
                            <Share2 size={14} /> Repasse
                        </button>
                        <Link
                            href={`/veiculo/${carro.id}`}
                            className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-red-600 transition-all tracking-widest shadow-lg shadow-slate-200"
                        >
                            <Zap size={14} className="fill-white" /> Business / IA Insights
                        </Link>
                    </div>
                </div>
                )) : (
                    <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">O estoque está vazio. Comece a acelerar!</div>
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
                <h2 className="text-xl font-black uppercase italic tracking-tight text-gray-900">Anúncio de Repasse</h2>
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
                <div className="px-8 pb-8 pt-4 flex gap-3">
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
                    onClick={() => gerarRepasse(repasseCarroId)}
                    className="px-4 py-4 bg-gray-100 text-gray-400 font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-gray-200 transition-all"
                    title="Gerar novamente"
                  >
                    ↺
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
