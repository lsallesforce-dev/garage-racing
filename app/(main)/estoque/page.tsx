"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Edit3, Plus, Car, Zap, Search, ArrowRight } from "lucide-react";

export default function ListaEstoque() {
  const [carros, setCarros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const buscarEstoque = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('veiculos')
        .select('*')
        .order('status_venda', { ascending: true })
        .order('created_at', { ascending: false });
      if (data) setCarros(data);
      setLoading(false);
    };
    buscarEstoque();
  }, []);

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
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
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

                    <div className="flex gap-3">
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
    </div>
  );
}
