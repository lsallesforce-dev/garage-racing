"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, X, Check, Phone, Users, Calendar, Tag } from "lucide-react";

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
  visita:   { label: "Visita",   cor: "bg-gray-500",   icone: Users    },
  ligacao:  { label: "Ligação",  cor: "bg-gray-400",   icone: Phone    },
  reuniao:  { label: "Reunião",  cor: "bg-gray-600",   icone: Calendar },
  outro:    { label: "Outro",    cor: "bg-gray-300",   icone: Tag      },
};

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

interface ModalState {
  open: boolean;
  evento?: Evento;
  diaPreSelecionado?: string;
}

export default function AgendaSemana() {
  const [semanaBase, setSemanaBase] = useState<Date>(() => startOfWeek(new Date()));
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ open: false });

  const dias = Array.from({ length: 7 }, (_, i) => addDays(semanaBase, i));

  const carregarEventos = useCallback(async () => {
    setLoading(true);
    const inicio = semanaBase.toISOString();
    const fim = addDays(semanaBase, 7).toISOString();
    const res = await fetch(`/api/agenda?inicio=${inicio}&fim=${fim}`);
    if (res.ok) setEventos(await res.json());
    setLoading(false);
  }, [semanaBase]);

  useEffect(() => { carregarEventos(); }, [carregarEventos]);

  function eventosNoDia(dia: Date): Evento[] {
    return eventos.filter(e => {
      const d = new Date(e.data_hora);
      return (
        d.getFullYear() === dia.getFullYear() &&
        d.getMonth() === dia.getMonth() &&
        d.getDate() === dia.getDate()
      );
    }).sort((a, b) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
  }

  async function marcarFeito(id: string) {
    await fetch(`/api/agenda/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "feito" }),
    });
    carregarEventos();
  }

  async function deletar(id: string) {
    await fetch(`/api/agenda/${id}`, { method: "DELETE" });
    setModal({ open: false });
    carregarEventos();
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  return (
    <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-6 md:p-8 mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-black uppercase italic text-gray-300 tracking-tight">Agenda da Semana</h3>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
            {semanaBase.getDate()} {MESES[semanaBase.getMonth()]} — {addDays(semanaBase, 6).getDate()} {MESES[addDays(semanaBase, 6).getMonth()]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSemanaBase(s => addDays(s, -7))}
            className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setSemanaBase(startOfWeek(new Date()))}
            className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-[10px] font-black uppercase tracking-widest transition-colors">
            Semana
          </button>
          <button onClick={() => setSemanaBase(s => addDays(s, 7))}
            className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Grade da semana */}
      <div className="grid grid-cols-7 gap-1.5">
        {dias.map((dia, i) => {
          const isHoje = dia.getTime() === hoje.getTime();
          const evs = eventosNoDia(dia);
          const iso = dia.toISOString().slice(0, 10) + "T09:00:00";

          return (
            <div key={i} className={`rounded-2xl p-2 min-h-[120px] flex flex-col gap-1 transition-colors
              ${isHoje ? "bg-red-50 border border-red-100" : "bg-gray-50/60 border border-transparent hover:border-gray-100"}`}>

              {/* Header do dia */}
              <div className="flex items-center justify-between mb-1 px-1">
                <div>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${isHoje ? "text-red-500" : "text-gray-400"}`}>
                    {DIAS_SEMANA[i]}
                  </p>
                  <p className={`text-sm font-black leading-none ${isHoje ? "text-red-600" : "text-gray-700"}`}>
                    {dia.getDate()}
                  </p>
                </div>
                <button
                  onClick={() => setModal({ open: true, diaPreSelecionado: iso })}
                  className="w-5 h-5 rounded-full bg-gray-200 hover:bg-red-500 hover:text-white text-gray-500 flex items-center justify-center transition-colors">
                  <Plus size={10} />
                </button>
              </div>

              {/* Eventos */}
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-3 h-3 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
                </div>
              ) : evs.map(ev => {
                const cfg = tipoConfig[ev.tipo] || tipoConfig.outro;
                const hora = new Date(ev.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                return (
                  <button key={ev.id}
                    onClick={() => setModal({ open: true, evento: ev })}
                    className={`w-full text-left rounded-xl px-2 py-1.5 transition-all hover:opacity-90 group
                      ${ev.status === "feito" ? "opacity-40" : ""}`}>
                    <div className="flex items-center gap-1 rounded-lg px-1.5 py-1 bg-gray-100">
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
          );
        })}
      </div>

      {/* Modal */}
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

// ─── Modal ────────────────────────────────────────────────────────────────────
function ModalEvento({
  evento,
  diaPreSelecionado,
  onClose,
  onSalvo,
  onDeletar,
  onMarcarFeito,
}: {
  evento?: Evento;
  diaPreSelecionado?: string;
  onClose: () => void;
  onSalvo: () => void;
  onDeletar: (id: string) => void;
  onMarcarFeito: (id: string) => void;
}) {
  const [titulo, setTitulo] = useState(evento?.titulo || "");
  const [descricao, setDescricao] = useState(evento?.descricao || "");
  const [tipo, setTipo] = useState<Tipo>(evento?.tipo || "visita");
  const [dataHora, setDataHora] = useState(
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

        {/* Tipo */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {(Object.entries(tipoConfig) as [Tipo, typeof tipoConfig[Tipo]][]).map(([t, cfg]) => (
            <button key={t} onClick={() => setTipo(t)}
              className={`py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
                ${tipo === t ? `${cfg.cor} text-white` : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {cfg.label}
            </button>
          ))}
        </div>

        {/* Título */}
        <input
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
          placeholder="Ex: Visita - João Silva"
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 mb-3"
        />

        {/* Data/hora */}
        <input
          type="datetime-local"
          value={dataHora}
          onChange={e => setDataHora(e.target.value)}
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500/30 mb-3"
        />

        {/* Descrição */}
        <textarea
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          placeholder="Observações (opcional)"
          rows={2}
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none mb-4"
        />

        {/* Info: criado pela IA */}
        {evento?.created_by === "ia" || evento?.created_by === "whatsapp" ? (
          <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mb-3">
            ⚡ Criado pela IA
          </p>
        ) : null}

        {/* Ações */}
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
