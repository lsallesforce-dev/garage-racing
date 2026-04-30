"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, X, Phone, Users, Calendar, Tag } from "lucide-react";

type View = "dia" | "semana" | "mes";
type Tipo = "visita" | "ligacao" | "reuniao" | "outro";
type StatusAgenda = "pendente" | "feito" | "cancelado";

interface Evento {
  id: string;
  titulo: string;
  descricao?: string;
  data_hora: string;
  tipo: Tipo;
  status: StatusAgenda;
  created_by: string;
  leads?: { nome: string; wa_id: string } | null;
}

const tipoConfig: Record<Tipo, { label: string; cor: string; icone: React.ElementType }> = {
  visita:  { label: "Visita",  cor: "bg-gray-500", icone: Users    },
  ligacao: { label: "Ligação", cor: "bg-gray-400", icone: Phone    },
  reuniao: { label: "Reunião", cor: "bg-gray-600", icone: Calendar },
  outro:   { label: "Outro",   cor: "bg-gray-300", icone: Tag      },
};

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DIAS_FULL   = ["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"];
const MESES       = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

interface ModalState { open: boolean; evento?: Evento; diaPreSelecionado?: string; }

export default function AgendaSemana() {
  const hoje = startOfDay(new Date());
  const [view,     setView]     = useState<View>("semana");
  const [baseDate, setBaseDate] = useState<Date>(() => startOfDay(new Date()));
  const [eventos,  setEventos]  = useState<Evento[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<ModalState>({ open: false });

  const carregarEventos = useCallback(async () => {
    setLoading(true);
    let inicio: Date, fim: Date;
    if (view === "dia") {
      inicio = baseDate;
      fim    = addDays(baseDate, 1);
    } else if (view === "semana") {
      const mon = startOfWeek(baseDate);
      inicio = mon;
      fim    = addDays(mon, 7);
    } else {
      const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
      inicio = startOfWeek(first);
      fim    = addDays(inicio, 42);
    }
    const res = await fetch(`/api/agenda?inicio=${inicio.toISOString()}&fim=${fim.toISOString()}`);
    if (res.ok) setEventos(await res.json());
    setLoading(false);
  }, [view, baseDate]);

  useEffect(() => { carregarEventos(); }, [carregarEventos]);

  function navigate(dir: 1 | -1) {
    setBaseDate(prev => {
      if (view === "dia")    return addDays(prev, dir);
      if (view === "semana") return addDays(prev, dir * 7);
      const r = new Date(prev); r.setMonth(r.getMonth() + dir); return r;
    });
  }

  async function deletar(id: string) {
    await fetch(`/api/agenda/${id}`, { method: "DELETE" });
    setModal({ open: false });
    carregarEventos();
  }

  async function marcarFeito(id: string) {
    await fetch(`/api/agenda/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "feito" }),
    });
    carregarEventos();
  }

  let headerLabel = "";
  if (view === "dia") {
    headerLabel = `${baseDate.getDate()} de ${MESES[baseDate.getMonth()]} ${baseDate.getFullYear()}`;
  } else if (view === "semana") {
    const mon = startOfWeek(baseDate);
    const sun = addDays(mon, 6);
    headerLabel = `${mon.getDate()} ${MESES[mon.getMonth()].slice(0,3)} — ${sun.getDate()} ${MESES[sun.getMonth()].slice(0,3)}`;
  } else {
    headerLabel = `${MESES[baseDate.getMonth()]} ${baseDate.getFullYear()}`;
  }

  return (
    <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-6 md:p-8 mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-black uppercase italic text-gray-300 tracking-tight">Agenda</h3>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{headerLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl overflow-hidden border border-gray-200">
            {(["dia", "semana", "mes"] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors
                  ${view === v ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                {v === "dia" ? "Dia" : v === "semana" ? "Semana" : "Mês"}
              </button>
            ))}
          </div>
          <button onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setBaseDate(startOfDay(new Date()))}
            className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-[10px] font-black uppercase tracking-widest transition-colors">
            Hoje
          </button>
          <button onClick={() => navigate(1)}
            className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {view === "dia" && (
        <ViewDia eventos={eventos} baseDate={baseDate} hoje={hoje} loading={loading}
          onAdd={() => setModal({ open: true, diaPreSelecionado: baseDate.toISOString().slice(0,10) + "T09:00:00" })}
          onEdit={ev => setModal({ open: true, evento: ev })} />
      )}
      {view === "semana" && (
        <ViewSemana eventos={eventos} baseDate={baseDate} hoje={hoje} loading={loading}
          onAdd={iso => setModal({ open: true, diaPreSelecionado: iso })}
          onEdit={ev => setModal({ open: true, evento: ev })} />
      )}
      {view === "mes" && (
        <ViewMes eventos={eventos} baseDate={baseDate} hoje={hoje} loading={loading}
          onDayClick={day => { setBaseDate(day); setView("dia"); }}
          onAdd={iso => setModal({ open: true, diaPreSelecionado: iso })} />
      )}

      {modal.open && (
        <ModalEvento
          evento={modal.evento}
          diaPreSelecionado={modal.diaPreSelecionado}
          onClose={() => setModal({ open: false })}
          onSalvo={carregarEventos}
          onDeletar={deletar}
          onMarcarFeito={marcarFeito}
        />
      )}
    </div>
  );
}

// ─── View Dia ─────────────────────────────────────────────────────────────────
function ViewDia({ eventos, baseDate, hoje, loading, onAdd, onEdit }: {
  eventos: Evento[]; baseDate: Date; hoje: Date; loading: boolean;
  onAdd: () => void; onEdit: (ev: Evento) => void;
}) {
  const isHoje = isSameDay(baseDate, hoje);
  const evs = eventos
    .filter(e => isSameDay(new Date(e.data_hora), baseDate))
    .sort((a, b) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className={`text-sm font-black uppercase tracking-widest ${isHoje ? "text-red-500" : "text-gray-600"}`}>
          {isHoje ? "Hoje" : DIAS_FULL[baseDate.getDay() === 0 ? 6 : baseDate.getDay() - 1]}
        </p>
        <button onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-900 hover:text-white text-gray-600 text-[10px] font-black uppercase tracking-widest transition-colors">
          <Plus size={11} /> Novo
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-14">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
        </div>
      ) : evs.length === 0 ? (
        <div className="text-center py-14 text-gray-300 text-xs font-black uppercase tracking-widest">
          Nenhum compromisso
        </div>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
          {evs.map(ev => <EventRow key={ev.id} ev={ev} onClick={() => onEdit(ev)} />)}
        </div>
      )}
    </div>
  );
}

// ─── View Semana ──────────────────────────────────────────────────────────────
function ViewSemana({ eventos, baseDate, hoje, loading, onAdd, onEdit }: {
  eventos: Evento[]; baseDate: Date; hoje: Date; loading: boolean;
  onAdd: (iso: string) => void; onEdit: (ev: Evento) => void;
}) {
  const mon  = startOfWeek(baseDate);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(mon, i));

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {dias.map((dia, i) => {
        const isHoje = isSameDay(dia, hoje);
        const evs = eventos
          .filter(e => isSameDay(new Date(e.data_hora), dia))
          .sort((a, b) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
        const iso = dia.toISOString().slice(0, 10) + "T09:00:00";

        return (
          <div key={i} className={`rounded-2xl p-2 flex flex-col gap-1 transition-colors
            ${isHoje ? "bg-red-50 border border-red-100" : "bg-gray-50/60 border border-transparent hover:border-gray-100"}`}>
            <div className="flex items-center justify-between mb-1 px-1">
              <div>
                <p className={`text-[9px] font-black uppercase tracking-widest ${isHoje ? "text-red-500" : "text-gray-400"}`}>
                  {DIAS_SEMANA[i]}
                </p>
                <p className={`text-sm font-black leading-none ${isHoje ? "text-red-600" : "text-gray-700"}`}>
                  {dia.getDate()}
                </p>
              </div>
              <button onClick={() => onAdd(iso)}
                className="w-5 h-5 rounded-full bg-gray-200 hover:bg-red-500 hover:text-white text-gray-500 flex items-center justify-center transition-colors">
                <Plus size={10} />
              </button>
            </div>
            <div className="overflow-y-auto max-h-52 space-y-1">
              {loading ? (
                <div className="flex justify-center py-3">
                  <div className="w-3 h-3 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
                </div>
              ) : evs.map(ev => {
                const cfg  = tipoConfig[ev.tipo] || tipoConfig.outro;
                const hora = new Date(ev.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                return (
                  <button key={ev.id} onClick={() => onEdit(ev)}
                    className={`w-full text-left rounded-xl px-1.5 py-1 bg-gray-100 hover:bg-gray-200 transition-all ${ev.status === "feito" ? "opacity-40" : ""}`}>
                    <div className="flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.cor}`} />
                      <div className="min-w-0">
                        <p className={`text-[9px] font-black uppercase tracking-wide truncate text-gray-700 ${ev.status === "feito" ? "line-through" : ""}`}>
                          {ev.titulo}
                        </p>
                        <p className="text-[8px] text-gray-500 font-bold">{hora}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── View Mês ─────────────────────────────────────────────────────────────────
function ViewMes({ eventos, baseDate, hoje, loading, onDayClick, onAdd }: {
  eventos: Evento[]; baseDate: Date; hoje: Date; loading: boolean;
  onDayClick: (day: Date) => void; onAdd: (iso: string) => void;
}) {
  const firstOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const gridStart    = startOfWeek(firstOfMonth);
  const days         = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DIAS_SEMANA.map(d => (
          <div key={d} className="text-center text-[9px] font-black uppercase tracking-widest text-gray-400 py-1">{d}</div>
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-14">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, i) => {
            const isCurrentMonth = day.getMonth() === baseDate.getMonth();
            const isHoje = isSameDay(day, hoje);
            const evs = eventos.filter(e => isSameDay(new Date(e.data_hora), day));
            const iso = day.toISOString().slice(0, 10) + "T09:00:00";

            return (
              <div key={i}
                className={`rounded-xl min-h-[72px] flex flex-col p-1.5 transition-colors group
                  ${isHoje
                    ? "bg-red-50 border border-red-200"
                    : isCurrentMonth
                      ? "bg-gray-50 border border-transparent hover:border-gray-200 hover:bg-gray-100"
                      : "opacity-30 bg-transparent border border-transparent"}`}>
                <div className="flex items-center justify-between mb-1">
                  <button onClick={() => onDayClick(day)}
                    className={`text-xs font-black leading-none rounded-lg px-1 py-0.5 transition-colors
                      ${isHoje ? "text-white bg-red-500" : "text-gray-700 hover:bg-gray-200"}`}>
                    {day.getDate()}
                  </button>
                  <button onClick={() => onAdd(iso)}
                    className="w-4 h-4 rounded-full bg-gray-200 hover:bg-red-500 hover:text-white text-gray-400 items-center justify-center transition-colors hidden group-hover:flex">
                    <Plus size={8} />
                  </button>
                </div>
                <div className="space-y-0.5 overflow-hidden">
                  {evs.slice(0, 3).map(ev => {
                    const cfg = tipoConfig[ev.tipo] || tipoConfig.outro;
                    return (
                      <button key={ev.id} onClick={() => onDayClick(day)}
                        className="w-full flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-white transition-colors">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.cor}`} />
                        <p className="text-[8px] font-bold text-gray-600 truncate leading-tight">{ev.titulo}</p>
                      </button>
                    );
                  })}
                  {evs.length > 3 && (
                    <button onClick={() => onDayClick(day)}
                      className="w-full text-left text-[8px] font-black text-gray-400 px-1 hover:text-gray-600 transition-colors">
                      +{evs.length - 3} mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Event Row (view Dia) ─────────────────────────────────────────────────────
function EventRow({ ev, onClick }: { ev: Evento; onClick: () => void }) {
  const cfg  = tipoConfig[ev.tipo] || tipoConfig.outro;
  const hora = new Date(ev.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const Icon = cfg.icone;

  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-2xl p-3 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all ${ev.status === "feito" ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl ${cfg.cor} flex items-center justify-center shrink-0`}>
          <Icon size={15} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-black text-gray-800 truncate ${ev.status === "feito" ? "line-through" : ""}`}>
            {ev.titulo}
          </p>
          {ev.descricao && (
            <p className="text-[11px] text-gray-500 truncate mt-0.5">{ev.descricao}</p>
          )}
          {ev.leads && (
            <p className="text-[10px] text-gray-400 font-bold mt-0.5">👤 {ev.leads.nome || ev.leads.wa_id}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-black text-gray-700">{hora}</p>
          <p className={`text-[9px] font-bold uppercase tracking-wide mt-0.5
            ${ev.status === "feito" ? "text-green-500" : "text-gray-400"}`}>
            {ev.status === "feito" ? "Feito" : cfg.label}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function ModalEvento({
  evento, diaPreSelecionado, onClose, onSalvo, onDeletar, onMarcarFeito,
}: {
  evento?: Evento; diaPreSelecionado?: string;
  onClose: () => void; onSalvo: () => void;
  onDeletar: (id: string) => void; onMarcarFeito: (id: string) => void;
}) {
  const [titulo,    setTitulo]    = useState(evento?.titulo || "");
  const [descricao, setDescricao] = useState(evento?.descricao || "");
  const [tipo,      setTipo]      = useState<Tipo>(evento?.tipo || "visita");
  const [dataHora,  setDataHora]  = useState(
    evento
      ? new Date(evento.data_hora).toISOString().slice(0, 16)
      : (diaPreSelecionado ? diaPreSelecionado.slice(0, 16) : new Date().toISOString().slice(0, 16))
  );
  const [saving, setSaving] = useState(false);

  async function handleSalvar() {
    if (!titulo.trim()) return;
    setSaving(true);
    if (evento) {
      await fetch(`/api/agenda/${evento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, descricao, tipo, data_hora: new Date(dataHora).toISOString() }),
      });
    } else {
      await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, descricao, tipo, data_hora: new Date(dataHora).toISOString() }),
      });
    }
    setSaving(false);
    onSalvo();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h4 className="font-black uppercase italic text-gray-900 text-sm">
            {evento ? "Editar compromisso" : "Novo compromisso"}
          </h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {(Object.entries(tipoConfig) as [Tipo, typeof tipoConfig[Tipo]][]).map(([t, cfg]) => (
            <button key={t} onClick={() => setTipo(t)}
              className={`py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
                ${tipo === t ? `${cfg.cor} text-white` : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {cfg.label}
            </button>
          ))}
        </div>

        <input value={titulo} onChange={e => setTitulo(e.target.value)}
          placeholder="Ex: Visita - João Silva"
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 mb-3" />

        <input type="datetime-local" value={dataHora} onChange={e => setDataHora(e.target.value)}
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500/30 mb-3" />

        <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
          placeholder="Observações (opcional)" rows={2}
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none mb-4" />

        {(evento?.created_by === "ia" || evento?.created_by === "whatsapp") && (
          <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mb-3">⚡ Criado pela IA</p>
        )}

        <div className="flex gap-2">
          {evento && (
            <button onClick={() => onDeletar(evento.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-500 text-[10px] font-black uppercase tracking-widest hover:bg-red-50 hover:text-red-500 transition-colors">
              <X size={12} /> Excluir
            </button>
          )}
          <button onClick={handleSalvar} disabled={saving || !titulo.trim()}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-500 disabled:opacity-40 transition-colors">
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
