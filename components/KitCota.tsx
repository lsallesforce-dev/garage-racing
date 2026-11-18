"use client";

// Contador da cota mensal de Kits de Postagem + modal de upgrade (ver lib/kit-cota.ts).
// Starter/trial = 5 kits/mês; Pro/Premium = ilimitado. 1 kit = 1 veículo no mês.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Infinity as InfinityIcon } from "lucide-react";

export interface CotaKits {
  usados: number;
  limite: number | null;
  plano: string | null;
}

export function useCotaKits() {
  const [cota, setCota] = useState<CotaKits | null>(null);
  const recarregar = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/cota", { cache: "no-store" });
      if (res.ok) setCota(await res.json());
    } catch {
      /* contador é cosmético — sem cota, sem banner */
    }
  }, []);
  useEffect(() => {
    recarregar();
  }, [recarregar]);
  return { cota, recarregar };
}

export function KitCotaBanner({ cota, onUpgrade }: { cota: CotaKits | null; onUpgrade: () => void }) {
  if (!cota) return null;
  if (cota.limite === null) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[11px] font-bold text-emerald-700">
        <InfinityIcon size={14} /> Kits ilimitados no seu plano · {cota.usados} gerados este mês
      </div>
    );
  }
  const restam = Math.max(0, cota.limite - cota.usados);
  const tom =
    restam === 0
      ? "border-red-200 bg-red-50 text-red-700"
      : restam === 1
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-gray-100 bg-gray-50 text-gray-700";
  const msg =
    restam === 0
      ? "Cota do mês usada. Carros já gerados continuam editáveis."
      : restam === 1
        ? "Resta 1 kit este mês."
        : `Restam ${restam} kits este mês.`;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 text-[11px] font-bold ${tom}`}>
      <span>
        <strong>{cota.usados}/{cota.limite}</strong> kits de postagem · {msg}
      </span>
      {restam <= 1 && (
        <button
          onClick={onUpgrade}
          className="rounded-xl bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-gray-700"
        >
          Kits ilimitados →
        </button>
      )}
    </div>
  );
}

// Pacote avulso só existe no PagBank (mesma flag do /assinar).
const PACOTE_ATIVO = process.env.NEXT_PUBLIC_GATEWAY === "pagbank";

function PacoteKits() {
  const [estado, setEstado] = useState<"idle" | "gerando" | "pix" | "pago" | "erro">("idle");
  const [pix, setPix] = useState<{ order_id: string; qr_code: string; qr_code_text: string; valor: number } | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (estado !== "pix" || !pix) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/pagbank/status/${pix.order_id}`, { cache: "no-store" });
        const d = await r.json();
        if (d.status === "paid") {
          setEstado("pago");
          clearInterval(iv);
        }
      } catch { /* tenta de novo no próximo tick */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [estado, pix]);

  async function comprar() {
    setEstado("gerando");
    try {
      const r = await fetch("/api/pagbank/pacote-kits", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erro ao gerar PIX");
      setPix(d);
      setEstado("pix");
    } catch (e: any) {
      setMsg(e.message);
      setEstado("erro");
    }
  }

  if (estado === "pago") {
    return <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-center text-[12px] font-bold text-emerald-700">Pago! +5 kits liberados — feche e gere o próximo.</p>;
  }
  if (estado === "pix" && pix) {
    return (
      <div className="mt-3 rounded-2xl border border-gray-100 p-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pix.qr_code} alt="QR Code PIX" className="mx-auto h-40 w-40" />
        <button
          onClick={() => navigator.clipboard?.writeText(pix.qr_code_text)}
          className="mt-2 text-[11px] font-black uppercase tracking-widest text-blue-600"
        >
          Copiar PIX copia e cola
        </button>
        <p className="mt-1 text-[10px] text-gray-400">Aguardando pagamento…</p>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={comprar}
        disabled={estado === "gerando"}
        className="mt-3 w-full rounded-2xl border-2 border-gray-900 py-3 text-[11px] font-black uppercase tracking-widest text-gray-900 hover:bg-gray-50 disabled:opacity-50"
      >
        {estado === "gerando" ? "Gerando PIX…" : "Só este mês: +5 kits por R$ 49 (PIX)"}
      </button>
      {estado === "erro" && <p className="mt-2 text-center text-[11px] text-red-600">{msg}</p>}
    </>
  );
}

export function UpgradeKitsModal({ cota, onClose }: { cota: CotaKits | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-[2rem] bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-5 top-5 text-gray-400 hover:text-gray-700" aria-label="Fechar">
          <X size={18} />
        </button>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600">
          <Sparkles size={20} className="text-white" />
        </div>
        <p className="text-lg font-black uppercase italic tracking-tight text-gray-900">
          Você usou os {cota?.limite ?? 5} kits do mês
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          {cota?.plano === "trial"
            ? "No período de teste você tem 5 kits de postagem. Assine o Pro e gere kit pra todo carro que entrar, sem limite."
            : "Seu plano inclui 5 kits de postagem por mês. No Pro você gera kit pra todo carro que entrar, sem limite — e os carros já gerados continuam editáveis."}
        </p>
        <Link
          href="/assinar?plano=pro&upgrade=1"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-3.5 text-[11px] font-black uppercase tracking-widest text-white hover:bg-red-500"
        >
          Fazer upgrade pro Pro — kits ilimitados
        </Link>
        {PACOTE_ATIVO && <PacoteKits />}
        <button
          onClick={onClose}
          className="mt-3 w-full py-2 text-[11px] font-bold text-gray-400 hover:text-gray-600"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
