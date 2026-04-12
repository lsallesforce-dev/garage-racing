"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Copy, LogOut, Zap } from "lucide-react";

const PIX_KEY = process.env.NEXT_PUBLIC_PIX_KEY || "contato@autozap.digital";
const PRECO = "R$ 297/mês";
const WHATSAPP_SUPORTE = process.env.NEXT_PUBLIC_WHATSAPP_SUPORTE || "5511999999999";

const FEATURES = [
  "IA treinada para vendas de veículos",
  "Atendimento automático 24h no WhatsApp",
  "Análise de vídeo e foto com IA",
  "Vitrine pública com link direto",
  "Central de chat e gestão de leads",
  "Alertas de lead quente para o gerente",
  "Equipe de vendas e RBAC",
  "Suporte via WhatsApp",
];

function diasRestantes(dataISO?: string | null): number | null {
  if (!dataISO) return null;
  const diff = new Date(dataISO).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function AssinarPage() {
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("nome_empresa, trial_ends_at")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setNomeEmpresa(data.nome_empresa ?? "");
            setTrialEndsAt(data.trial_ends_at ?? null);
          }
        });
    });
  }, []);

  function copiarPix() {
    navigator.clipboard.writeText(PIX_KEY).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const dias = diasRestantes(trialEndsAt);
  const expirado = dias !== null && dias === 0;

  return (
    <div className="min-h-screen bg-[#efefed] flex flex-col items-center justify-center px-4 py-16">

      {/* Header mínimo */}
      <div className="w-full max-w-lg flex items-center justify-between mb-10">
        <span className="text-xl font-black uppercase italic tracking-tighter">
          <span className="text-gray-900">AUTO</span>
          <span className="text-red-600">ZAP</span>
        </span>
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 transition-colors">
          <LogOut size={12} /> Sair
        </button>
      </div>

      {/* Banner de status */}
      {expirado ? (
        <div className="w-full max-w-lg mb-6 bg-red-50 border border-red-200 rounded-2xl px-5 py-4 text-center">
          <p className="text-red-700 font-black text-[11px] uppercase tracking-widest">Seu período gratuito encerrou</p>
          <p className="text-red-500 text-[10px] mt-1">Assine para reativar o atendimento automático no WhatsApp</p>
        </div>
      ) : dias !== null && dias <= 7 ? (
        <div className="w-full max-w-lg mb-6 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-center">
          <p className="text-amber-700 font-black text-[11px] uppercase tracking-widest">
            {dias === 1 ? "Último dia de trial!" : `${dias} dias restantes no trial`}
          </p>
          <p className="text-amber-600 text-[10px] mt-1">Assine agora para não perder nenhum lead</p>
        </div>
      ) : null}

      {/* Card principal */}
      <div className="w-full max-w-lg bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">

        {/* Topo */}
        <div className="bg-gray-900 px-8 py-8 text-center">
          <div className="inline-flex items-center gap-2 bg-red-600/20 border border-red-500/30 rounded-full px-4 py-1.5 mb-4">
            <Zap size={11} className="text-red-400 fill-red-400" />
            <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Plano Pro</span>
          </div>
          <p className="text-5xl font-black text-white tracking-tighter">R$ 297</p>
          <p className="text-gray-400 text-sm mt-1">por mês · cancele quando quiser</p>
          {nomeEmpresa && (
            <p className="text-gray-500 text-[10px] uppercase tracking-widest mt-3">para {nomeEmpresa}</p>
          )}
        </div>

        {/* Features */}
        <div className="px-8 py-6 border-b border-gray-100">
          <ul className="flex flex-col gap-3">
            {FEATURES.map(f => (
              <li key={f} className="flex items-center gap-3">
                <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                <span className="text-[12px] text-gray-700 font-medium">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* PIX */}
        <div className="px-8 py-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">
            Como assinar — via PIX
          </p>

          <ol className="flex flex-col gap-3 mb-6">
            {[
              "Copie a chave PIX abaixo",
              `Faça um PIX de ${PRECO} com o nome da sua empresa na descrição`,
              "Envie o comprovante no WhatsApp de suporte",
              "Ativamos seu acesso em até 1 hora útil",
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-gray-100 text-[10px] font-black text-gray-500 flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span className="text-[12px] text-gray-600">{s}</span>
              </li>
            ))}
          </ol>

          {/* Chave PIX */}
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 mb-4">
            <code className="flex-1 text-[12px] text-gray-700 font-mono break-all">{PIX_KEY}</code>
            <button
              onClick={copiarPix}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                copiado ? "bg-green-500 text-white" : "bg-gray-900 text-white hover:bg-red-600"
              }`}
            >
              {copiado ? <><CheckCircle2 size={11} /> Copiado</> : <><Copy size={11} /> Copiar</>}
            </button>
          </div>

          {/* WhatsApp suporte */}
          <a
            href={`https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent(`Olá! Quero assinar o AutoZap. Minha empresa: ${nomeEmpresa || "—"}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-black uppercase text-[11px] tracking-widest transition-all"
          >
            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.531 5.843L.057 23.571l5.88-1.473A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.371l-.358-.213-3.713.929.978-3.591-.234-.368A9.818 9.818 0 1112 21.818z"/>
            </svg>
            Enviar comprovante no WhatsApp
          </a>
        </div>
      </div>

      <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-6 text-center">
        Dúvidas? Fale com a gente no WhatsApp · AutoZap © {new Date().getFullYear()}
      </p>
    </div>
  );
}
