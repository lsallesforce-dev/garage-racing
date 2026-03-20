"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { StatsCard } from "@/components/StatsCard";
import { Vehicle } from "@/types/vehicle";

export default function DashboardPage() {
  const [veiculos, setVeiculos] = useState<Vehicle[]>([]);
  const [stats, setStats] = useState({
    total_estoque: 0,
    total_leads: 0,
    leads_quentes: 0,
    respostas_ia: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // 1. Buscar Estoque
        const { data: vData } = await supabase
          .from("veiculos")
          .select("*")
          .order("created_at", { ascending: false });
        
        setVeiculos(vData || []);

        // 2. Buscar KPIs da View
        const { data: sData } = await supabase
          .from("dashboard_summary")
          .select("*")
          .single();
        
        if (sData) setStats(sData);

      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return (
    <main className="flex-1 p-6 md:p-12 max-w-7xl mx-auto w-full">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter">GARAGE DASHBOARD</h1>
          <p className="text-slate-500 uppercase tracking-widest text-[10px] font-bold mt-1">Analytics & Conversão Premium</p>
        </div>
        <div className="flex gap-4">
          <Link 
            href="/upload" 
            className="bg-primary text-white px-8 py-4 rounded-xl font-black text-sm hover:scale-105 transition-all shadow-xl shadow-primary/20"
          >
            + NOVO VEÍCULO
          </Link>
        </div>
      </header>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
        <StatsCard title="Estoque IA" value={stats.total_estoque} change={12} />
        <StatsCard title="Total de Leads" value={stats.total_leads} change={5} />
        <StatsCard title="Leads Quentes" value={stats.leads_quentes} change={stats.total_leads > 0 ? Math.round((stats.leads_quentes / stats.total_leads) * 100) : 0} />
        <StatsCard title="Conversas IA" value={stats.respostas_ia} change={24} />
      </div>

      <section>
        <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white uppercase tracking-tight flex items-center gap-3">
                <span className="w-1 h-6 bg-primary rounded-full"></span>
                Estoque Analisado
            </h2>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{veiculos.length} Veículos Ativos</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="bg-card h-64 rounded-2xl border border-white/5"></div>)}
          </div>
        ) : veiculos.length === 0 ? (
          <div className="text-center py-32 border-2 border-dashed border-white/5 rounded-3xl">
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Nenhum veículo no pátio digital</p>
            <Link href="/upload" className="text-primary mt-4 inline-block font-black hover:underline">Iniciar primeira análise →</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {veiculos.map((v) => (
              <div key={v.id} className="bg-card border border-white/5 rounded-3xl overflow-hidden group hover:border-primary/20 transition-all duration-500 shadow-2xl">
                <div className="p-8 border-b border-white/5">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="text-2xl font-black text-white leading-none mb-1">{v.marca}</h3>
                        <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">{v.modelo}</p>
                    </div>
                    <div className="text-right">
                        <span className="text-accent font-mono font-black text-lg">R$ {v.preco_sugerido?.toLocaleString('pt-BR')}</span>
                    </div>
                  </div>
                  <div className="flex gap-4 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    <span>{v.ano_modelo}</span>
                    <span>•</span>
                    <span>{v.combustivel}</span>
                    <span>•</span>
                    <span>{v.quilometragem_estimada} KM</span>
                  </div>
                </div>
                
                <div className="p-8 space-y-6">
                  <div>
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3">Destaques da IA</p>
                    <div className="flex flex-wrap gap-2">
                        {v.pontos_fortes_venda?.slice(0, 3).map((p, i) => (
                            <span key={i} className="bg-white/5 text-[9px] text-slate-400 px-3 py-1.5 rounded-lg border border-white/5">
                                {p}
                            </span>
                        ))}
                    </div>
                  </div>
                  
                  <div className="pt-6 flex justify-between items-center">
                    <div className="flex -space-x-2">
                        <div className="w-6 h-6 rounded-full bg-primary border border-black flex items-center justify-center text-[8px] font-bold">PRO</div>
                        <div className="w-6 h-6 rounded-full bg-accent border border-black flex items-center justify-center text-[8px] font-bold">RAG</div>
                    </div>
                    <Link 
                        href={`/veiculo/${v.id}`} 
                        className="text-[10px] font-black text-white hover:text-primary transition-colors flex items-center gap-2 uppercase tracking-widest"
                    >
                        Relatório Completo
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="arrow-right"></path></svg>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
