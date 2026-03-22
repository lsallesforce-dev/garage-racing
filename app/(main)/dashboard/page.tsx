"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { StatsCard } from "@/components/StatsCard";
import { Vehicle } from "@/types/vehicle";
import { Car, Users, TrendingUp, ShieldCheck, ArrowRight, Search, Bell, Plus, PlusCircle } from "lucide-react";

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
        const { data: vData } = await supabase
          .from("veiculos")
          .select("*")
          .order("created_at", { ascending: false });
        
        setVeiculos(vData || []);

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
    <main className="flex-1 p-10 bg-[#efefed]">
      {/* 🏆 Header Profissional */}
      <header className="flex justify-between items-center mb-10 pb-6 border-b border-gray-200">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">Analytics Dashboard</h1>
          <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold">Garage Racing • Performance Intelligence</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-gray-400">
             <Search size={20} className="cursor-pointer hover:text-gray-600 transition-colors" />
             <Bell size={20} className="cursor-pointer hover:text-gray-600 transition-colors" />
          </div>
          <Link 
            href="/upload" 
            className="bg-[#d65243] text-white px-6 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-red-900/10 hover:bg-[#c0483c] transition-all flex items-center gap-2"
          >
            <Plus size={16} strokeWidth={3} />
            Nova Análise
          </Link>
        </div>
      </header>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-10">
        <StatsCard title="Total Vehicles" value={veiculos.length} change={20} timeframe="vs last month" />
        <StatsCard title="Total Sold" value={Math.floor(veiculos.length * 0.15)} change={12} timeframe="vs last month" />
        <StatsCard title="Total Earned" value={`R$ ${(veiculos.length * 125000).toLocaleString()}`} change={6} timeframe="vs last month" />
        <StatsCard title="Clicked" value={121} change={2} isNegative timeframe="vs last month" />
        <StatsCard title="Conversion" value="6%" change={10} timeframe="vs last month" />
      </div>

      {/* Main Content Sections (Middle Row) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
        {/* Most Viewed Vehicles Chart Placeholder */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm h-[400px] flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
              Most Viewed Vehicles
              <span className="text-[#d65243] text-[10px] lowercase font-bold cursor-pointer hover:underline">Expand</span>
            </h3>
            <div className="flex gap-4">
                <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400">
                  <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                  Mercedes-Benz GLC
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400">
                  <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                  BMW X4
                </div>
            </div>
          </div>
          
          <div className="flex-1 flex items-end gap-1 px-4 pb-4">
             {/* Mock Wave Chart using CSS spikes/divs */}
             {Array.from({length: 40}).map((_, i) => (
               <div key={i} className="flex-1 space-y-1 group relative">
                 <div 
                   className="w-full bg-blue-100/50 group-hover:bg-blue-200 transition-all rounded-t-sm" 
                   style={{ height: `${20 + Math.sin(i * 0.5) * 15 + Math.random() * 20}%` }}
                 ></div>
                 <div 
                   className="w-full bg-yellow-100/50 group-hover:bg-yellow-200 transition-all rounded-t-sm" 
                   style={{ height: `${10 + Math.cos(i * 0.3) * 10 + Math.random() * 15}%` }}
                 ></div>
               </div>
             ))}
          </div>
          <div className="flex justify-between px-4 pt-4 border-t border-gray-50 text-[9px] font-black text-gray-300 uppercase tracking-widest">
            <span>01</span><span>05</span><span>10</span><span>15</span><span>20</span><span>25</span><span>30</span>
          </div>
        </div>

        {/* Chat / Inbox Section */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm h-[400px] flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
              Conversas IA
              <span className="text-[#d65243] text-[10px] lowercase font-bold cursor-pointer hover:underline">View All</span>
            </h3>
            <Search size={14} className="text-gray-300" />
          </div>

          <div className="space-y-6 flex-1 overflow-y-auto pr-2">
            {[
              { name: "Heidi Kane", msg: "Where can I come to see this car?", time: "5 minutes ago", id: "#1568444", unread: 3 },
              { name: "Oliver Kramp", msg: "Hello, what is the terms for car financing?", time: "18 minutes ago", id: "#1560306", unread: 1 },
              { name: "Bruce Adams", msg: "I agree. When can you make a deal?", time: "30 minutes ago", id: "#1564268", unread: 1 },
              { name: "Jane Shevchenko", msg: "I need some information about the car!", time: "Yesterday", id: "#1562147", unread: 1 },
            ].map((chat, i) => (
              <div key={i} className="flex gap-4 group cursor-pointer hover:bg-gray-50 p-2 -m-2 rounded-xl transition-all">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0 flex items-center justify-center font-bold text-gray-400 text-xs shadow-inner uppercase">
                  {chat.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <p className="text-[11px] font-black text-gray-900 truncate uppercase">{chat.name}</p>
                    <span className="text-[9px] font-bold text-gray-300 whitespace-nowrap ml-2 uppercase leading-none">{chat.time}</span>
                  </div>
                  <p className="text-[9px] text-gray-400 font-bold mb-1 uppercase tracking-tight">{chat.id}</p>
                  <p className="text-[10px] text-gray-500 truncate leading-snug">{chat.msg}</p>
                </div>
                <div className="flex flex-col justify-end">
                   {chat.unread > 0 && (
                     <span className="bg-[#d65243] text-white text-[8px] font-black w-4 h-4 flex items-center justify-center rounded-sm">
                       {chat.unread}
                     </span>
                   )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row - Reviews & Inventory Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Statistics Area */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm h-[350px]">
           <div className="flex justify-between items-center mb-8">
              <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                Tendências de Compra
                <span className="text-[#d65243] text-[10px] lowercase font-bold cursor-pointer hover:underline">Expand</span>
              </h3>
              <div className="flex gap-4">
                <span className="text-[10px] font-black text-gray-300 uppercase">Compare</span>
                <span className="text-[10px] font-black text-gray-300 uppercase">Sep 2025</span>
              </div>
           </div>
           
           <div className="flex items-end h-40 gap-4 justify-between px-10">
              {Array.from({length: 12}).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1 group">
                   <div className="w-0.5 bg-gray-100 group-hover:bg-red-200 transition-all rounded-full relative" style={{ height: `${40 + Math.random() * 60}px` }}>
                      <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-blue-400 border-2 border-white shadow-sm"></div>
                      <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 rounded-full bg-yellow-400 border-2 border-white shadow-sm"></div>
                   </div>
                </div>
              ))}
           </div>
        </div>

        {/* Reviews Section */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm h-[350px]">
          <div className="flex justify-between items-center mb-8">
              <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                Satisfação
                <span className="text-[#d65243] text-[10px] lowercase font-bold cursor-pointer hover:underline">View All</span>
              </h3>
              <div className="flex items-center gap-1">
                 <span className="text-sm font-black text-gray-900">4.4</span>
                 <div className="flex gap-0.5">
                   {[1,2,3,4,5].map(s => <div key={s} className={`w-2.5 h-2.5 rounded-full ${s <= 4 ? 'bg-yellow-400' : 'bg-gray-100'}`}></div>)}
                 </div>
              </div>
           </div>

           <div className="grid grid-cols-3 gap-2 mb-8">
              <div className="bg-gray-50/50 p-4 rounded-xl flex flex-col items-center">
                 <p className="text-[14px] font-black text-gray-900">399</p>
                 <p className="text-[7px] font-black text-gray-300 uppercase mt-1">Total</p>
              </div>
              <div className="bg-gray-50/50 p-4 rounded-xl flex flex-col items-center">
                 <p className="text-[14px] font-black text-gray-900">300</p>
                 <p className="text-[7px] font-black text-gray-300 uppercase mt-1">Respondidas</p>
              </div>
              <div className="bg-gray-50/50 p-4 rounded-xl flex flex-col items-center">
                 <p className="text-[14px] font-black text-gray-900">21</p>
                 <p className="text-[7px] font-black text-gray-300 uppercase mt-1">Novas</p>
              </div>
           </div>

           <div className="space-y-3">
              {[84, 10, 4, 1, 1].map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                   <span className="text-[9px] font-black text-gray-300 w-3">{5-i}</span>
                   <div className="flex-1 h-1.5 bg-gray-50 rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-400" style={{ width: `${p}%` }}></div>
                   </div>
                   <span className="text-[9px] font-black text-gray-300 w-6 text-right">{p}%</span>
                </div>
              ))}
           </div>
        </div>
      </div>
    </main>
  );
}