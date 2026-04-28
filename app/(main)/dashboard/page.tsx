"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Flame, TrendingUp, Users, Car, Zap, Brain, LayoutDashboard, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState({
    faturamento: 0,
    leadsTotais: 0,
    eficienciaIA: 0,
    carrosPatio: 0,
    frios: 0,
    mornos: 0,
    quentes: 0
  });
  const [atividades, setAtividades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [diasTrial, setDiasTrial] = useState<number | null>(null);
  const [planoId, setPlanoId] = useState<string>("pro");

  // Flash: Função que puxa a realidade do banco de dados
  const carregarDashboard = async () => {
    setLoading(true);
    try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id;
        if (!uid) return;

        // 1. Faturamento (Soma de carros VENDIDOS)
        const { data: vendidos } = await supabase.from('veiculos').select('preco_sugerido').eq('status_venda', 'VENDIDO').eq('user_id', uid);
        const totalFaturado = vendidos?.reduce((acc, curr) => acc + Number(curr.preco_sugerido || 0), 0) || 0;

        // 2. Leads e Temperaturas
        const { data: leads } = await supabase.from('leads').select('status').eq('user_id', uid);
        const contagem = {
        total: leads?.length || 0,
        frios: leads?.filter(l => l.status === 'FRIO').length || 0,
        mornos: leads?.filter(l => l.status === 'MORNO').length || 0,
        quentes: leads?.filter(l => l.status === 'QUENTE').length || 0,
        };

        // 3. Carros no Pátio (DISPONÍVEIS)
        const { count: totalPatio } = await supabase
            .from('veiculos')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', uid)
            .or('status_venda.eq.DISPONIVEL,status_venda.is.null');

        // 4. Atividades Recentes (Movimentação)
        const { data: recents } = await supabase
        .from('leads')
        .select('*, veiculos(modelo)')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false })
        .limit(5);

        setStats({
        faturamento: totalFaturado,
        leadsTotais: contagem.total,
        eficienciaIA: contagem.total > 0 ? Math.round((contagem.quentes / contagem.total) * 100) : 0,
        carrosPatio: totalPatio || 0,
        frios: contagem.frios,
        mornos: contagem.mornos,
        quentes: contagem.quentes
        });
        if (recents) setAtividades(recents);
    } catch (error) {
        console.error("Flash Error:", error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    carregarDashboard();
    // Carrega nome da empresa para o greeting
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("nome_empresa, nome_fantasia, trial_ends_at, plano_ativo, plano_vence_em, plano")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const row = data?.[0];
          if (row?.nome_empresa) setNomeEmpresa(row.nome_fantasia || row.nome_empresa);
          if (row?.plano) setPlanoId(row.plano);
          if (row?.trial_ends_at && !row?.plano_ativo) {
            const diff = new Date(row.trial_ends_at).getTime() - Date.now();
            const dias = Math.max(0, Math.ceil(diff / 86400000));
            if (dias <= 7) setDiasTrial(dias);
          }
        });
    });
  }, []);

  return (
    <div className="p-4 md:p-8 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-7xl mx-auto">
        {/* Flash: Header com Título e Botões de Ação */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-8 md:mb-12">
            <div>
            <h1 className="text-3xl md:text-6xl font-black italic uppercase text-gray-300/80 leading-none mb-2 tracking-tighter">Radar do Pátio</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">Bem-vindo à {nomeEmpresa || "AutoZap"}, Comandante.</p>
            </div>
        </div>

        {/* Banner trial expirando */}
        {diasTrial !== null && (
          <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl px-5 py-4 mb-6 border ${
            diasTrial === 0
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`w-5 h-5 shrink-0 ${diasTrial === 0 ? "text-red-500" : "text-amber-500"}`} />
              <div>
                <p className={`font-black text-sm uppercase italic tracking-tight ${diasTrial === 0 ? "text-red-700" : "text-amber-700"}`}>
                  {diasTrial === 0 ? "Seu trial encerrou hoje!" : `${diasTrial} ${diasTrial === 1 ? "dia restante" : "dias restantes"} no trial`}
                </p>
                <p className={`text-xs mt-0.5 ${diasTrial === 0 ? "text-red-500" : "text-amber-600"}`}>
                  Assine agora para não perder nenhum lead
                </p>
              </div>
            </div>
            <Link href={`/assinar?plano=${planoId}`}
              className={`shrink-0 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white transition whitespace-nowrap ${
                diasTrial === 0 ? "bg-red-600 hover:bg-red-500" : "bg-amber-500 hover:bg-amber-400"
              }`}>
              Assinar agora →
            </Link>
          </div>
        )}

        {/* Flash: Cards de Performance (Telemetria) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
            <div className="bg-slate-900 p-5 md:p-8 rounded-[2rem] md:rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group col-span-2 md:col-span-1">
            <div className="absolute -right-4 -top-4 text-white/5 group-hover:text-white/10 transition-colors">
                <TrendingUp size={120} />
            </div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Faturamento (Pátio)</p>
            <h4 className="text-3xl font-black italic tracking-tighter">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(stats.faturamento)}
            </h4>
            <p className="text-[9px] text-green-400 font-bold uppercase mt-2 italic">↑ Performance Estável</p>
            </div>
            
            <div className="bg-white p-5 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Eficiencia IA (Lucas)</p>
            <h4 className="text-3xl md:text-4xl font-black italic tracking-tighter">{stats.eficienciaIA}%</h4>
            <p className="text-[9px] text-slate-900 font-bold uppercase mt-2 italic">Conversão p/ Quente</p>
            </div>

            <div className="bg-white p-5 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Total de Leads</p>
            <h4 className="text-3xl md:text-4xl font-black italic tracking-tighter">{stats.leadsTotais}</h4>
            <p className="text-[9px] text-blue-500 font-bold uppercase mt-2 italic">Novas Oportunidades</p>
            </div>

            <div className="bg-white p-5 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Carros em Pátio</p>
            <h4 className="text-3xl md:text-4xl font-black italic tracking-tighter">{stats.carrosPatio}</h4>
            <p className="text-[9px] text-orange-500 font-bold uppercase mt-2 italic">Giro de Estoque</p>
            </div>
        </div>

        {/* Flash: Termômetro de Leads */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 hover:shadow-md transition-all">
            <p className="text-[10px] font-black uppercase text-blue-500 mb-1 tracking-widest">Leads Frios</p>
            <h4 className="text-3xl font-black italic tracking-tighter">{stats.frios}</h4>
            <p className="text-[9px] text-gray-400 font-bold uppercase mt-2">Apenas Curiosos</p>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 hover:shadow-md transition-all">
            <p className="text-[10px] font-black uppercase text-amber-500 mb-1 tracking-widest">Interesse Real</p>
            <h4 className="text-3xl font-black italic tracking-tighter">{stats.mornos}</h4>
            <p className="text-[9px] text-gray-400 font-bold uppercase mt-2">Simulando Troca</p>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-red-100 bg-red-50/20 hover:scale-[1.02] transition-all">
            <p className="text-[10px] font-black uppercase text-red-600 mb-1 tracking-widest text-left">🔥 Oportunidade</p>
            <h4 className="text-3xl font-black italic text-red-600 tracking-tighter">{stats.quentes}</h4>
            <p className="text-[9px] text-red-600/60 font-bold uppercase mt-2">Visita Agendada</p>
            </div>
        </div>

        {/* Flash: Movimentação ao Vivo */}
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm">
            <div className="flex justify-between items-center mb-8">
            <h3 className="text-2xl font-black uppercase italic text-gray-300">Movimentação no Pátio</h3>
            <span className="flex items-center gap-2 text-[10px] font-black text-red-600 uppercase tracking-widest">
                <span className="w-2 h-2 bg-red-600 rounded-full animate-ping"></span> Ao Vivo
            </span>
            </div>

            <div className="grid gap-3">
            {!loading ? (
                atividades.length > 0 ? atividades.map((lead) => (
                    <div key={lead.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 hover:bg-gray-50/50 rounded-3xl transition-all border border-transparent hover:border-gray-100 group">
                    <div className="flex items-center gap-6 min-w-[200px]">
                        <div className={`w-3 h-3 rounded-full ${lead.status === 'QUENTE' ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-blue-400'}`}></div>
                        <div>
                        <p className="text-sm font-black uppercase tracking-tight">{lead.nome || "Lead Interessado"}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">De olho: <span className="text-red-600">{lead.veiculos?.modelo || "Maquinário"}</span></p>
                        </div>
                    </div>
                    <p className="text-sm text-gray-500 italic flex-1 md:px-12 py-3 md:py-0 truncate max-w-[500px]">
                        "{lead.resumo_negociacao || "O Lucas (IA) está qualificando o interesse..."}"
                    </p>
                    <button
                        onClick={() => router.push(`/chat?wa_id=${lead.wa_id}`)}
                        className="px-6 py-3 bg-slate-100 rounded-2xl text-[9px] font-black uppercase hover:bg-red-600 hover:text-white transition-all tracking-widest"
                    >
                        Detalhes
                    </button>
                    </div>
                )) : (
                    <div className="py-20 text-center bg-gray-50/50 rounded-3xl border-2 border-dashed border-gray-100 flex flex-col items-center">
                        <Zap size={32} className="text-gray-200 mb-4" />
                        <p className="text-[10px] text-gray-300 uppercase font-black tracking-[0.2em]">Aguardando as primeiras interações da IA hoje...</p>
                    </div>
                )
            ) : (
                <div className="py-20 text-center flex flex-col items-center">
                    <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin mb-4"></div>
                </div>
            )}
            </div>
        </div>

      </div>
    </div>
  );
}