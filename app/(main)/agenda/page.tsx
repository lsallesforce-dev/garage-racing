"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Clock, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import AgendaSemana from "@/components/AgendaSemana";

interface AgendaEvento {
  id: string;
  titulo: string;
  data_hora: string;
  tipo: string;
  status?: string;
  created_by: string;
  leads?: { nome: string; wa_id: string } | null;
}

export default function AgendaPage() {
  const [stats, setStats] = useState({
    hoje: 0,
    semana: 0,
    aproximados: 0,
    feitos: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      const agora = new Date();
      const fimSemana = new Date(agora);
      fimSemana.setDate(agora.getDate() + 7);
      const inicioHoje = new Date(agora);
      inicioHoje.setHours(0, 0, 0, 0);
      const fimHoje = new Date(inicioHoje);
      fimHoje.setDate(fimHoje.getDate() + 1);

      try {
        const res = await fetch(`/api/agenda?inicio=${inicioHoje.toISOString()}&fim=${fimSemana.toISOString()}`);
        if (res.ok) {
          const eventos: AgendaEvento[] = await res.json();
          const hoje = eventos.filter((e) => {
            const d = new Date(e.data_hora);
            return d >= inicioHoje && d < fimHoje;
          });
          const aproximados = eventos.filter((e) => e.titulo.includes("(horário aproximado)")).length;
          const feitos = eventos.filter((e) => e.status === "feito").length;
          setStats({
            hoje: hoje.length,
            semana: eventos.length,
            aproximados,
            feitos,
          });
        }
      } catch (e) {
        console.error("Falha ao carregar stats da agenda:", e);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      {/* Header da página */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-gray-900 flex items-center gap-3">
            <CalendarDays className="text-red-500" size={32} />
            Agenda
          </h1>
          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">
            Visitas, ligações e compromissos da loja
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard
          icon={Clock}
          label="Hoje"
          value={loading ? "..." : String(stats.hoje)}
          color="text-red-500"
          bg="bg-red-50"
        />
        <StatCard
          icon={CalendarDays}
          label="Próximos 7 dias"
          value={loading ? "..." : String(stats.semana)}
          color="text-blue-500"
          bg="bg-blue-50"
        />
        <StatCard
          icon={AlertCircle}
          label="Horário aproximado"
          value={loading ? "..." : String(stats.aproximados)}
          color="text-amber-500"
          bg="bg-amber-50"
          tooltip="Compromissos sem hora exata — confirme com o cliente"
        />
        <StatCard
          icon={CheckCircle2}
          label="Concluídos"
          value={loading ? "..." : String(stats.feitos)}
          color="text-green-500"
          bg="bg-green-50"
        />
      </div>

      {/* Legenda */}
      <div className="mb-4 flex items-center gap-3 flex-wrap text-[10px] font-bold uppercase tracking-widest text-gray-400">
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-gray-500" /> Visita
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-gray-400" /> Ligação
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-gray-600" /> Reunião
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles size={10} className="text-blue-500" />
          <span className="text-blue-500">Criado pela IA</span>
        </span>
      </div>

      {/* Componente principal */}
      <AgendaSemana />

      {/* Aviso sobre horário aproximado */}
      {!loading && stats.aproximados > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <p className="text-sm font-black text-amber-900 mb-1">
              {stats.aproximados} compromisso{stats.aproximados > 1 ? "s" : ""} sem hora exata
            </p>
            <p className="text-xs text-amber-700">
              Esses compromissos foram criados com horário aproximado (cliente disse só "à tarde", "cedo", etc).
              Vale confirmar com o cliente o horário exato antes da visita.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
  tooltip,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
  bg: string;
  tooltip?: string;
}) {
  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 p-4 md:p-5 shadow-sm relative group"
      title={tooltip}
    >
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
        <Icon size={18} className={color} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className="text-2xl md:text-3xl font-black italic tracking-tighter text-gray-900">{value}</p>
    </div>
  );
}
