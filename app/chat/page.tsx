"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MessageSquare, User, Zap } from "lucide-react";

export default function CentralChat() {
  const [conversas, setConversas] = useState<any[]>([]);

  // Flash: Busca todas as conversas ativas no banco de leads
  useEffect(() => {
    const carregarConversas = async () => {
      const { data } = await supabase
        .from('leads')
        .select('*, veiculos(modelo, marca)')
        .order('updated_at', { ascending: false });
      
      if (data) setConversas(data);
    };
    carregarConversas();
  }, []);

  return (
    <div className="p-10 bg-[#f4f4f2] min-h-screen">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-5xl font-black italic uppercase text-slate-900 leading-none">Central de Chat</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">
            Monitorando o Lucas (IA) em tempo real
          </p>
        </div>
        <div className="bg-red-600 px-6 py-2 rounded-full text-white text-[10px] font-black uppercase animate-pulse">
          {conversas.length} Atendimentos Hoje
        </div>
      </div>

      <div className="grid gap-4">
        {conversas.length > 0 ? conversas.map((chat) => (
          <div key={chat.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 flex items-center justify-between shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center gap-6">
              <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white group-hover:bg-red-600 transition-colors">
                <User size={20} />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase italic leading-none">
                  {chat.nome || "Cliente Interessado"}
                </h3>
                <p className="text-[10px] font-bold text-red-600 uppercase mt-1">
                  Interesse: {chat.veiculos?.marca} {chat.veiculos?.modelo}
                </p>
              </div>
            </div>

            <div className="flex-1 px-10">
              <p className="text-xs text-gray-500 italic truncate max-w-[400px]">
                "{chat.resumo_negociacao || "O Lucas (IA) está iniciando a qualificação..."}"
              </p>
            </div>

            <div className="flex items-center gap-4">
                <div className="text-right mr-4 hidden md:block">
                   <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">Status Lucas</p>
                   <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Ativo / IA</p>
                </div>
                <a 
                href={`https://wa.me/${chat.wa_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 bg-green-500 text-black text-[10px] font-black uppercase rounded-xl hover:scale-105 transition-all shadow-lg shadow-green-200"
                >
                Assumir no WhatsApp
                </a>
            </div>
          </div>
        )) : (
          <div className="bg-white p-20 rounded-[3rem] border border-dashed border-gray-200 flex flex-col items-center justify-center text-center">
             <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-6 text-gray-300">
                <MessageSquare size={32} />
             </div>
             <p className="text-gray-400 italic uppercase font-bold text-sm tracking-widest">Nenhuma conversa ativa no momento...</p>
          </div>
        )}
      </div>
    </div>
  );
}
