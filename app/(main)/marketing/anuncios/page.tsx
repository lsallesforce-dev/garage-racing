"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, Clock, AlertCircle, Trash2, RefreshCw,
  ExternalLink, ChevronDown, ChevronUp, Megaphone,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined) {
  if (!v) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Badge de status ──────────────────────────────────────────────────────────

function StatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  const [tip, setTip] = useState(false);

  const cfg: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    ativo:     { label: "Ativo",     icon: <CheckCircle2 size={10} />, cls: "bg-green-100 text-green-700" },
    publicado: { label: "Publicado", icon: <CheckCircle2 size={10} />, cls: "bg-green-100 text-green-700" },
    pendente:  { label: "Pendente",  icon: <Clock size={10} />,        cls: "bg-yellow-100 text-yellow-700" },
    rejeitado: { label: "Rejeitado", icon: <AlertCircle size={10} />,  cls: "bg-red-100 text-red-600" },
  };

  const c = cfg[status] ?? { label: status, icon: <Clock size={10} />, cls: "bg-gray-100 text-gray-500" };

  return (
    <div className="relative">
      {tip && <div className="fixed inset-0 z-40" onClick={() => setTip(false)} />}
      <button
        onClick={() => reason && setTip(v => !v)}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${c.cls} ${reason ? "cursor-pointer" : "cursor-default"}`}
      >
        {c.icon} {c.label}
      </button>
      {tip && reason && (
        <div className="absolute top-full mt-1.5 left-0 w-64 bg-gray-900 text-white rounded-xl p-3 shadow-xl z-50 text-[10px] leading-relaxed">
          <p className="font-black text-gray-400 uppercase tracking-widest mb-1 text-[8px]">Motivo da OLX</p>
          {reason}
          <div className="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900" />
        </div>
      )}
    </div>
  );
}

// ─── Ícone de portal ──────────────────────────────────────────────────────────

function PortalIcon({ portal }: { portal: string }) {
  if (portal === "olx") return (
    <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shrink-0">
      <span className="text-[8px] font-black text-white">OLX</span>
    </div>
  );
  if (portal === "webmotors") return (
    <div className="w-7 h-7 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
      <span className="text-[7px] font-black text-white leading-none">WEB</span>
    </div>
  );
  return (
    <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
      <span className="text-[7px] font-black text-white">META</span>
    </div>
  );
}

// ─── Card de anúncio ──────────────────────────────────────────────────────────

function AnuncioCard({ anuncio, onDelete, onRefresh }: {
  anuncio: any;
  onDelete: (id: string) => void;
  onRefresh: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [localStatus, setLocalStatus] = useState(anuncio.status);
  const [localReason, setLocalReason] = useState<string | null>(anuncio.snapshot?.reason ?? null);

  const fotoCapa = anuncio.fotos?.[0] ?? null;
  const demaisFotos: string[] = anuncio.fotos?.slice(1) ?? [];

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/anuncios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anuncioId: anuncio.id }),
      });
      const data = await res.json();
      if (data.status) { setLocalStatus(data.status); setLocalReason(data.reason ?? null); }
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover anúncio "${anuncio.titulo}" da ${anuncio.portal.toUpperCase()}?`)) return;
    setDeleting(true);
    try {
      await fetch("/api/anuncios", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anuncioId: anuncio.id }),
      });
      onDelete(anuncio.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden">
      {/* Linha principal */}
      <div className="flex items-center gap-4 p-4">
        {/* Foto capa */}
        <div className="w-24 h-16 rounded-xl overflow-hidden bg-gray-100 shrink-0">
          {fotoCapa
            ? <img src={fotoCapa} alt={anuncio.titulo} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-gray-300"><Megaphone size={20} /></div>
          }
        </div>

        {/* Info central */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <PortalIcon portal={anuncio.portal} />
            <p className="text-sm font-black uppercase italic text-gray-900 truncate">{anuncio.titulo}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={localStatus} reason={localReason} />
            <span className="text-[9px] text-gray-400 font-bold">
              Publicado em {fmtDate(anuncio.publicado_em)}
            </span>
          </div>
        </div>

        {/* Preço + ações */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <p className="text-sm font-black text-gray-900">{fmt(anuncio.preco)}</p>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Atualizar status"
              className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>
            {anuncio.portal_ad_id && (
              <a
                href={`https://www.olx.com.br/item/${anuncio.portal_ad_id}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Ver no portal"
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
              >
                <ExternalLink size={13} />
              </a>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Remover anúncio"
              className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={() => setExpanded(v => !v)}
              title="Ver detalhes"
              className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* Painel expandido */}
      {expanded && (
        <div className="border-t border-gray-50 px-4 pb-4 pt-3 space-y-4">
          {/* Descrição enviada */}
          {anuncio.descricao && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Descrição enviada ao portal</p>
              <p className="text-[11px] text-gray-600 leading-relaxed bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {anuncio.descricao}
              </p>
            </div>
          )}

          {/* Fotos enviadas */}
          {anuncio.fotos?.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                {anuncio.fotos.length} foto{anuncio.fotos.length !== 1 ? "s" : ""} enviada{anuncio.fotos.length !== 1 ? "s" : ""}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {anuncio.fotos.map((url: string, i: number) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Foto ${i + 1}`}
                    className="w-20 h-14 object-cover rounded-xl shrink-0 border border-gray-100"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Parâmetros técnicos */}
          {anuncio.snapshot?.params && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Dados técnicos enviados</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Combustível", value: anuncio.snapshot.params.fuel },
                  { label: "Câmbio",      value: anuncio.snapshot.params.gearbox },
                  { label: "Cor",         value: anuncio.snapshot.params.carcolor },
                  { label: "KM",          value: anuncio.snapshot.params.mileage?.toLocaleString("pt-BR") },
                  { label: "Ano",         value: anuncio.snapshot.params.regdate },
                  { label: "Placa",       value: anuncio.snapshot.params.vehicle_tag ?? "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 rounded-xl p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                    <p className="text-[11px] font-black text-gray-700">{value ?? "—"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ad ID */}
          {anuncio.portal_ad_id && (
            <p className="text-[9px] text-gray-300 font-mono">
              ID no portal: {anuncio.portal_ad_id}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function AnunciosPage() {
  const router = useRouter();
  const [anuncios, setAnuncios] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filtro, setFiltro]     = useState<"todos" | "olx" | "webmotors" | "meta">("todos");

  useEffect(() => {
    fetch("/api/anuncios")
      .then(r => r.json())
      .then(({ anuncios }) => { setAnuncios(anuncios ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function handleDelete(id: string) {
    setAnuncios(prev => prev.filter(a => a.id !== id));
  }

  async function handleRefresh(id: string) {
    // handled inside AnuncioCard
  }

  const filtrados = filtro === "todos" ? anuncios : anuncios.filter(a => a.portal === filtro);

  const counts = {
    todos:      anuncios.length,
    olx:        anuncios.filter(a => a.portal === "olx").length,
    webmotors:  anuncios.filter(a => a.portal === "webmotors").length,
    meta:       anuncios.filter(a => a.portal === "meta").length,
  };

  return (
    <div className="p-4 md:p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <button
                onClick={() => router.push("/marketing")}
                className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 transition-colors"
              >
                ← Marketing
              </button>
            </div>
            <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-300 leading-none tracking-tighter">
              Anúncios
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400 mt-1">
              {anuncios.length} anúncio{anuncios.length !== 1 ? "s" : ""} publicado{anuncios.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Filtros por portal */}
          <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-100 shadow-sm self-start sm:self-auto">
            {(["todos", "olx", "webmotors", "meta"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
                  filtro === f ? "bg-gray-900 text-white shadow" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                {f === "todos" ? `Todos (${counts.todos})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-[2rem] border border-gray-100 p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-24 h-16 bg-gray-100 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded-full w-2/3" />
                    <div className="h-2.5 bg-gray-100 rounded-full w-1/3" />
                  </div>
                  <div className="h-5 bg-gray-200 rounded-full w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : filtrados.length === 0 ? (
          <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
            {filtro === "todos" ? "Nenhum anúncio publicado ainda." : `Nenhum anúncio no ${filtro.toUpperCase()}.`}
          </div>
        ) : (
          <div className="space-y-3">
            {filtrados.map(a => (
              <AnuncioCard
                key={a.id}
                anuncio={a}
                onDelete={handleDelete}
                onRefresh={handleRefresh}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
