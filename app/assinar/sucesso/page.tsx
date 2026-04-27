"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Zap, ArrowRight } from "lucide-react";

const PLANOS: Record<string, string> = { starter: "Starter", pro: "Pro" };

function SucessoContent() {
  const params  = useSearchParams();
  const planoId = params.get("plano") ?? "pro";
  const nome    = PLANOS[planoId] ?? "Pro";

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 bg-[#00ff88]/10 border border-[#00ff88]/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10 text-[#00ff88]" />
        </div>

        <div className="flex items-center justify-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-[#00ff88]" />
          <span className="text-[#00ff88] text-xs font-semibold tracking-wide uppercase">AutoZap</span>
        </div>

        <h1 className="text-3xl font-bold text-white mb-3">Pagamento confirmado!</h1>
        <p className="text-white/60 mb-2">
          Seu plano <span className="text-white font-semibold">{nome}</span> está ativo.
        </p>
        <p className="text-white/40 text-sm mb-8">
          Você receberá um e-mail de confirmação em instantes.
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 bg-[#00ff88] hover:bg-[#00dd77] text-black font-bold px-8 py-3 rounded-xl transition"
        >
          Ir para o painel <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

export default function SucessoPage() {
  return (
    <Suspense>
      <SucessoContent />
    </Suspense>
  );
}
