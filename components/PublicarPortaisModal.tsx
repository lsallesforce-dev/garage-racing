"use client";

// Modal de publicação de UM portal (OLX, Webmotors ou Mercado Livre).
// Antes era um modal só com os 3 empilhados: clicar em "OLX" abria também
// Webmotors e ML, e o lojista não sabia em qual tinha mexido.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, Send, X, AlertCircle } from "lucide-react";

export type Portal = "olx" | "webmotors" | "ml";

interface Veiculo {
  id: string;
  marca: string;
  modelo: string;
  versao?: string;
  ano_modelo?: number;
  preco_sugerido?: number;
  status_olx?: string | null;
  olx_ad_id?: string | null;
  status_webmotors?: string | null;
  status_ml?: string | null;
}

type CampoStatus = "status_olx" | "status_webmotors" | "status_ml";

interface Props {
  portal: Portal;
  veiculo: Veiculo;
  conectado: boolean;
  onClose: () => void;
  onStatusChange?: (campo: CampoStatus, valor: string) => void;
}

type PortalStatus = "idle" | "loading" | "ok" | "erro";

const PORTAIS: Record<Portal, {
  nome: string; sigla: string; rota: string; campo: CampoStatus;
  corIcone: string; corTexto: string; corBotao: string; semConexao: string;
}> = {
  olx: {
    nome: "OLX Autos", sigla: "OLX", rota: "/api/olx/publicar", campo: "status_olx",
    corIcone: "bg-purple-600", corTexto: "text-purple-700", corBotao: "bg-purple-600 hover:bg-purple-700",
    semConexao: "Conecte a conta OLX em Configurações → Portais.",
  },
  webmotors: {
    nome: "Webmotors", sigla: "WEB", rota: "/api/webmotors/publicar", campo: "status_webmotors",
    corIcone: "bg-red-600", corTexto: "text-red-700", corBotao: "bg-red-600 hover:bg-red-700",
    semConexao: "Cadastre as credenciais da Webmotors em Configurações → Portais.",
  },
  ml: {
    nome: "Mercado Livre", sigla: "ML", rota: "/api/mercadolivre/publicar", campo: "status_ml",
    corIcone: "bg-yellow-400", corTexto: "text-yellow-700", corBotao: "bg-yellow-400 hover:bg-yellow-500",
    semConexao: "Conecte a conta do Mercado Livre em Configurações → Portais.",
  },
};

/** Publicado de verdade = tem id do anúncio no portal (OLX) ou status "publicado". */
export function publicadoNoPortal(portal: Portal, v: Veiculo): boolean {
  if (portal === "olx") return !!v.olx_ad_id && (v.status_olx === "publicado" || v.status_olx === "pendente");
  if (portal === "webmotors") return v.status_webmotors === "publicado";
  return v.status_ml === "publicado";
}

export default function PublicarPortaisModal({ portal, veiculo, conectado, onClose, onStatusChange }: Props) {
  const router = useRouter();
  const cfg = PORTAIS[portal];
  const [status, setStatus] = useState<PortalStatus>(publicadoNoPortal(portal, veiculo) ? "ok" : "idle");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [link, setLink] = useState("");

  const nomeVeiculo = `${veiculo.marca} ${veiculo.modelo}${veiculo.versao ? ` ${veiculo.versao}` : ""}${veiculo.ano_modelo ? ` ${veiculo.ano_modelo}` : ""}`;

  async function publicar() {
    setStatus("loading");
    setErro("");
    setAviso("");
    setLink("");
    try {
      const res = await fetch(cfg.rota, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: veiculo.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro desconhecido");

      // ML: anúncio criado, mas o plano de classificado exige ativação/pagamento.
      if (portal === "ml" && json.payment_required) {
        onStatusChange?.(cfg.campo, "aguardando_pagamento");
        setStatus("ok");
        setAviso(json.aviso ?? "Anúncio criado — finalize a ativação na sua conta do Mercado Livre.");
        if (json.permalink) setLink(json.permalink);
        return; // não redireciona — deixa o link visível pra finalizar
      }

      onStatusChange?.(cfg.campo, "publicado");
      onClose();
      router.push("/marketing/anuncios");
    } catch (e: any) {
      setErro(e.message);
      setStatus("erro");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl ${cfg.corIcone} flex items-center justify-center flex-shrink-0`}>
              <span className="text-[9px] font-black text-white leading-none">{cfg.sigla}</span>
            </div>
            <div className="min-w-0">
              <h2 className={`text-base font-black uppercase italic tracking-tight ${cfg.corTexto}`}>
                Publicar na {cfg.nome}
              </h2>
              <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider mt-0.5 truncate">
                {nomeVeiculo}
              </p>
              {veiculo.preco_sugerido ? (
                <p className="text-sm font-black text-slate-800 mt-1">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(veiculo.preco_sugerido)}
                </p>
              ) : null}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-3">
          {!conectado ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
              <p className="text-[11px] font-bold text-gray-500">{cfg.semConexao}</p>
              <Link
                href="/configuracoes?tab=portais"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-wider hover:bg-red-600"
              >
                Ir para Configurações
              </Link>
            </div>
          ) : (
            <>
              {status === "ok" && !aviso && (
                <p className="text-[11px] font-bold text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 size={13} /> Este carro já está publicado na {cfg.nome}.
                </p>
              )}
              <button
                onClick={publicar}
                disabled={status === "loading" || status === "ok"}
                className={`w-full flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed ${cfg.corBotao}`}
              >
                {status === "loading" && <Loader2 size={12} className="animate-spin" />}
                {status === "ok" && <CheckCircle2 size={12} />}
                {status === "erro" && <AlertCircle size={12} />}
                {status === "idle" && <Send size={12} />}
                {status === "ok" ? "Publicado" : status === "loading" ? "Enviando…" : status === "erro" ? "Tentar de novo" : "Publicar"}
              </button>
              {erro && <p className="text-[10px] text-red-500 font-bold">{erro}</p>}
              {aviso && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-amber-600 font-bold">{aviso}</p>
                  {link && (
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-yellow-700 hover:text-yellow-800 underline underline-offset-2">
                      Abrir anúncio no Mercado Livre →
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          <button onClick={onClose} className="w-full pt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-700 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
