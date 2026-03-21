"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlusSquare, Search, Users, Car, ArrowRight, CheckCircle, Edit, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter(); // 🏎️ Navegação profissional do Next.js
  const [veiculos, setVeiculos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const carregarEstoque = async () => {
      const { data } = await supabase
        .from('veiculos')
        .select('*')
        .order('created_at', { ascending: false });

      if (data) setVeiculos(data);
      setLoading(false);
    };
    carregarEstoque();
  }, []);

  // 🗑️ Função para deletar o veículo do pátio
  const handleExcluirVeiculo = async (id: string) => {
    if (confirm("⚠️ Tem certeza que deseja remover este veículo do estoque? Esta ação é permanente.")) {
      const { error } = await supabase.from('veiculos').delete().eq('id', id);
      if (!error) {
        // Atualiza a lista na tela na hora
        setVeiculos(prev => prev.filter(v => v.id !== id));
      } else {
        alert("Erro ao remover veículo.");
      }
    }
  };

  // ✍️ Função para editar o veículo
  const handleEditarVeiculo = (carro: any) => {
    // Agora ele redireciona direto para a página do veículo usando o ID do pátio
    router.push(`/veiculo/${carro.id}`);
  };

  return (
    <main className="flex-1 p-10 bg-[#efefed]">
      {/* 🏆 Header Enxuto */}
      <header className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">Pátio Digital</h1>
          <p className="text-gray-400 uppercase tracking-widest text-[9px] font-bold italic">Gestão de Estoque e Leads em Tempo Real</p>
        </div>
        
        <Link href="/upload" className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all shadow-lg shadow-red-600/20">
          <PlusSquare size={16} /> Adicionar Veículo
        </Link>
      </header>

      {/* 📊 Cards de Foco Operacional */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 font-black">Veículos no Pátio</p>
          <h3 className="text-5xl font-black tracking-tighter text-gray-900">{veiculos.length}</h3>
        </div>
        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 font-black">Leads Quentes (WhatsApp)</p>
          <h3 className="text-5xl font-black tracking-tighter text-red-600">4</h3>
        </div>
        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 font-black">Vendedores Ativos</p>
          <h3 className="text-5xl font-black tracking-tighter text-red-600">12</h3>
        </div>
      </div>

      {/* 🏎️ Listagem de Veículos Real */}
      <section>
        <div className="flex justify-between items-end mb-8">
          <h2 className="text-xs font-black uppercase tracking-[0.3em] text-gray-400">Veículos Analisados Recentemente</h2>
          <Link href="/dashboard" className="text-[10px] font-black text-red-600 uppercase border-b-2 border-red-600/20 hover:border-red-600 transition-all pb-1">Ver Dashboard Completo</Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {loading ? (
            <div className="col-span-2 text-center py-20 text-gray-300 font-bold uppercase tracking-widest text-xs animate-pulse">Carregando Pátio...</div>
          ) : veiculos.length > 0 ? (
            veiculos.slice(0, 10).map((carro) => (
              <Link
                key={carro.id}
                href={`/veiculo/${carro.id}`}
                className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all relative overflow-hidden group"
              >
                {/* 🛠️ Botões de Gestão (Afastados do preço) */}
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-20">
                  <button 
                    onClick={(e) => { e.preventDefault(); handleEditarVeiculo(carro); }}
                    className="p-2 bg-white/80 backdrop-blur-sm text-gray-400 hover:text-red-600 rounded-xl transition-all border border-gray-100 shadow-sm"
                    title="Editar Veículo"
                  >
                    <Edit size={14} />
                  </button>
                  <button 
                    onClick={(e) => { e.preventDefault(); handleExcluirVeiculo(carro.id); }}
                    className="p-2 bg-white/80 backdrop-blur-sm text-gray-400 hover:text-red-600 rounded-xl transition-all border border-gray-100 shadow-sm"
                    title="Excluir do Pátio"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* 🏎️ Conteúdo do Card (Ajustado para não bater nos botões) */}
                <div className="flex justify-between items-start mb-6 pr-12">
                  <div>
                    <h3 className="text-3xl font-black uppercase tracking-tighter leading-none mb-1 text-gray-900 italic">
                      {carro.marca} {carro.modelo}
                    </h3>
                    <p className="text-red-600 font-bold text-[10px] uppercase tracking-widest mt-1">
                      {carro.versao} • {carro.ano_modelo}
                    </p>
                  </div>
                  
                  <div className="text-right">
                    <p className="text-[9px] text-gray-400 font-black uppercase mb-0.5 italic tracking-widest">Preço de Pátio</p>
                    <p className="text-2xl font-mono font-black text-gray-900 tracking-tighter">
                      R$ {carro.preco_sugerido?.toLocaleString('pt-BR') || "0"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-8">
                  {carro.pontos_fortes_venda?.slice(0, 3).map((ponto: string, i: number) => (
                    <span key={i} className="bg-gray-50 text-[9px] font-black text-gray-400 px-3 py-1.5 rounded-lg border border-gray-100 uppercase tracking-widest">
                      {ponto}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-6 border-t border-gray-50">
                   <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                      <span className="text-[9px] font-black uppercase text-gray-400 tracking-widest">IA Verificada</span>
                   </div>
                   <ArrowRight className="w-4 h-4 text-gray-200 group-hover:text-red-600 group-hover:translate-x-2 transition-all" />
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-2 bg-white/50 border-2 border-dashed border-gray-200 rounded-[2.5rem] p-20 text-center">
               <Car size={40} className="mx-auto text-gray-200 mb-4" />
               <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Nenhum veículo no pátio.</p>
               <Link href="/upload" className="text-red-600 text-[10px] font-black uppercase mt-4 block hover:underline">Fazer Primeira Análise</Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}