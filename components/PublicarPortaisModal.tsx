"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send, X, AlertCircle } from "lucide-react";

interface Veiculo {
  id: string;
  marca: string;
  modelo: string;
  versao?: string;
  ano_modelo?: number;
  preco_sugerido?: number;
  status_olx?: string;
  status_webmotors?: string;
}

interface Props {
  veiculo: Veiculo;
  olxConectado: boolean;
  wmConfigurado: boolean;
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: (campo: "status_olx" | "status_webmotors", valor: string) => void;
}

type PortalStatus = "idle" | "loading" | "ok" | "erro";

export default function PublicarPortaisModal({
  veiculo,
  olxConectado,
  wmConfigurado,
  isOpen,
  onClose,
  onStatusChange,
}: Props) {
  const [olxStatus, setOlxStatus]   = useState<PortalStatus>("idle");
  const [wmStatus, setWmStatus]     = useState<PortalStatus>(
    veiculo.status_webmotors === "publicado" ? "ok" : "idle"
  );
  const [olxErro, setOlxErro]       = useState("");
  const [wmErro, setWmErro]         = useState("");

  if (!isOpen) return null;

  const nomeVeiculo = `${veiculo.marca} ${veiculo.modelo}${veiculo.versao ? ` ${veiculo.versao}` : ""}${veiculo.ano_modelo ? ` ${veiculo.ano_modelo}` : ""}`;

  async function publicarOlx() {
    setOlxStatus("loading");
    setOlxErro("");
    try {
      const res = await fetch("/api/olx/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: veiculo.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro desconhecido");
      setOlxStatus("ok");
      onStatusChange?.("status_olx", "publicado");
    } catch (e: any) {
      setOlxErro(e.message);
      setOlxStatus("erro");
    }
  }

  async function publicarWm() {
    setWmStatus("loading");
    setWmErro("");
    try {
      const res = await fetch("/api/webmotors/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: veiculo.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro desconhecido");
      setWmStatus("ok");
      onStatusChange?.("status_webmotors", "publicado");
    } catch (e: any) {
      setWmErro(e.message);
      setWmStatus("erro");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h2 className="text-base font-black uppercase italic tracking-tight text-gray-900">
              Publicar nos portais
            </h2>
            <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider mt-0.5 truncate max-w-[220px]">
              {nomeVeiculo}
            </p>
            {veiculo.preco_sugerido && (
              <p className="text-sm font-black text-slate-800 mt-1">
                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(veiculo.preco_sugerido)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Portais */}
        <div className="px-6 pb-6 space-y-3">
          {/* OLX */}
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between p-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center">
                  <span className="text-[8px] font-black text-white">OLX</span>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase text-purple-700">OLX Autos</p>
                  {!olxConectado && (
                    <p className="text-[9px] text-gray-400">Conecte a conta em Configurações</p>
                  )}
                </div>
              </div>
              <button
                onClick={publicarOlx}
                disabled={!olxConectado || olxStatus === "loading" || olxStatus === "ok"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed
                  bg-purple-600 hover:bg-purple-700 text-white"
              >
                {olxStatus === "loading" && <Loader2 size={12} className="animate-spin" />}
                {olxStatus === "ok"      && <CheckCircle2 size={12} />}
                {olxStatus === "erro"    && <AlertCircle size={12} />}
                {olxStatus === "idle"    && <Send size={12} />}
                {olxStatus === "ok" ? "Publicado" : olxStatus === "loading" ? "Enviando…" : "Publicar"}
              </button>
            </div>
            {olxErro && (
              <div className="px-3.5 pb-3 text-[9px] text-red-500 font-bold">{olxErro}</div>
            )}
          </div>

          {/* Webmotors */}
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between p-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-red-600 flex items-center justify-center">
                  <span className="text-[7px] font-black text-white leading-none">WEB</span>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase text-red-700">Webmotors</p>
                  {!wmConfigurado && (
                    <p className="text-[9px] text-gray-400">Configure as credenciais em Configurações</p>
                  )}
                </div>
              </div>
              <button
                onClick={publicarWm}
                disabled={!wmConfigurado || wmStatus === "loading" || wmStatus === "ok"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed
                  bg-red-600 hover:bg-red-700 text-white"
              >
                {wmStatus === "loading" && <Loader2 size={12} className="animate-spin" />}
                {wmStatus === "ok"      && <CheckCircle2 size={12} />}
                {wmStatus === "erro"    && <AlertCircle size={12} />}
                {wmStatus === "idle"    && <Send size={12} />}
                {wmStatus === "ok" ? "Publicado" : wmStatus === "loading" ? "Enviando…" : "Publicar"}
              </button>
            </div>
            {wmErro && (
              <div className="px-3.5 pb-3 text-[9px] text-red-500 font-bold">{wmErro}</div>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-full pt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-700 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
