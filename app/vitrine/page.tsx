"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Zap, MessageCircle } from "lucide-react";

export default function VitrinePublica() {
  const [estoque, setEstoque] = useState<any[]>([]);
  // Flash: Busca apenas os carros prontos para venda no Pátio Virtual
  useEffect(() => {
    const carregarVitrine = async () => {
      const { data } = await supabase
        .from('veiculos')
        .select('id, marca, modelo, versao, ano_modelo, preco_sugerido, capa_marketing_url')
        .eq('status_venda', 'DISPONIVEL') // SÓ O QUE TÁ NO PÁTIO
        .order('created_at', { ascending: false });
      
      if (data) setEstoque(data);
    };
    carregarVitrine();
  }, []);

  return (
    <div className="bg-[#0a0a0a] min-h-screen text-white p-6 font-sans">
      {/* Flash: Header de Elite */}
      <div className="flex justify-between items-center mb-12 pt-4">
        <h1 className="text-2xl font-black uppercase italic tracking-tighter">Garage Racing</h1>
        <div className="flex items-center gap-2 bg-red-600 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-600/20">
          <Zap size={14} /> Pátio Digital
        </div>
      </div>

      {/* Flash: Grid de Oportunidades (Carregamento Automático) */}
      <div className="grid gap-8 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-7xl mx-auto">
        {estoque.map((carro) => (
          <div key={carro.id} className="bg-[#141414] rounded-[2.5rem] overflow-hidden border border-white/5 group transition-all hover:border-red-600/30 shadow-2xl shadow-black">
            {/* Imagem Premium (Gerada pelo Design Studio) */}
            <div className="relative aspect-video overflow-hidden">
                <img 
                src={carro.capa_marketing_url || 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop'} 
                alt={carro.modelo}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute top-4 left-4">
                    <span className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border border-white/10">Estoque Verificado</span>
                </div>
            </div>
            
            <div className="p-8">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter leading-none group-hover:text-red-500 transition-colors">{carro.marca} {carro.modelo}</h2>
              <p className="text-[10px] text-gray-500 font-bold uppercase mt-2 tracking-widest">{carro.versao || "Pacote Esportivo"} • {carro.ano_modelo || "2024"}</p>
              
              <div className="flex justify-between items-center mt-10">
                <div className="text-left">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-600 mb-1">Preço de Oportunidade</p>
                    <p className="text-3xl font-black text-white leading-none tracking-tighter">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(carro.preco_sugerido || 0)}
                    </p>
                </div>
                
                {/* O Ganhador de Lead: Link pro Zap com Contexto */}
                <a 
                  href={`https://wa.me/${process.env.NEXT_PUBLIC_ZAPI_PHONE || "5521999999999"}?text=Opa Lucas! Tenho interesse na ${carro.marca} ${carro.modelo} ${carro.versao || ""} que vi na vitrine!`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-5 bg-green-500 rounded-2xl text-black hover:scale-110 active:scale-95 transition-all shadow-xl shadow-green-900/20"
                >
                  <MessageCircle size={24} strokeWidth={2.5} />
                </a>
              </div>
            </div>
          </div>
        ))}

        {estoque.length === 0 && (
            <div className="col-span-full py-32 text-center border-2 border-dashed border-white/5 rounded-[3rem] bg-[#141414]/50">
                <Zap size={40} className="mx-auto text-gray-800 mb-4" />
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">O pátio está sendo reabastecido... <br/> Volte em instantes!</p>
            </div>
        )}
      </div>

      <footer className="mt-20 pb-12 text-center border-t border-white/5 pt-12">
         <p className="text-[9px] font-black uppercase tracking-widest text-gray-600">© 2026 Garage Racing • Pátio Digital de Elite</p>
         <p className="text-[8px] text-gray-800 mt-2 uppercase tracking-tighter font-bold">Imagens meramente ilustrativas • Sujeito a disponibilidade</p>
      </footer>

      {/* Flash: Botão de Consultoria do Lucas (IA) */}
      <div className="fixed bottom-8 right-8 z-50">
        <a 
          href={`https://wa.me/${process.env.NEXT_PUBLIC_ZAPI_PHONE || "5521999999999"}?text=Opa Lucas! Me ajuda a escolher um carro no pátio?`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 bg-red-600 hover:bg-black text-white p-4 rounded-full shadow-2xl shadow-red-900/40 transition-all hover:scale-105 active:scale-95 group"
        >
          <div className="bg-white/20 p-2 rounded-full">
            <Zap size={20} className="fill-white" />
          </div>
          <span className="font-black uppercase italic pr-4 text-[10px] tracking-widest">Falar com o Lucas</span>
        </a>
      </div>
    </div>
  );
}
