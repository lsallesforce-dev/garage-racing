"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";

type Step = 1 | 2;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nome_empresa: "",
    nome_agente: "",
    whatsapp: "",
    endereco: "",
    webhook_token: "",
    vitrine_slug: "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleFinish(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      await supabase
        .from("config_garage")
        .upsert(
          {
            user_id: user.id,
            nome_empresa: form.nome_empresa,
            nome_agente: form.nome_agente || "Assistente",
            whatsapp: form.whatsapp,
            endereco: form.endereco || null,
            webhook_token: form.webhook_token || null,
            vitrine_slug: form.vitrine_slug || null,
          },
          { onConflict: "user_id" }
        );

      // Seed vitrine slug no Redis se fornecido
      if (form.vitrine_slug) {
        fetch("/api/vitrine/seed-slug", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: form.vitrine_slug }),
        }).catch(() => {});
      }

      router.push("/");
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
            Bem-vindo ao<br />
            <span className="text-red-600">Painel</span>
          </h1>
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mt-2">
            Configure sua garagem em 2 passos
          </p>
          {/* Progress */}
          <div className="flex items-center justify-center gap-3 mt-6">
            {([1, 2] as const).map(s => (
              <div key={s} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black border-2 transition-all ${
                  s < step ? "bg-green-500 border-green-500 text-white" :
                  s === step ? "bg-gray-900 border-gray-900 text-white" :
                  "bg-white border-gray-200 text-gray-400"
                }`}>
                  {s < step ? <CheckCircle2 size={14} /> : s}
                </div>
                {s < 2 && <div className={`w-12 h-0.5 ${step > s ? "bg-green-500" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">

          {/* ── Step 1: Identidade ─────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={e => { e.preventDefault(); setStep(2); }} className="flex flex-col gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-5">
                  Passo 1 — Identidade da loja
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Nome da Empresa *
                </label>
                <input
                  required
                  type="text"
                  value={form.nome_empresa}
                  onChange={e => set("nome_empresa", e.target.value)}
                  placeholder="Ex: Garage Racing"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Nome do Agente IA
                </label>
                <input
                  type="text"
                  value={form.nome_agente}
                  onChange={e => set("nome_agente", e.target.value)}
                  placeholder="Ex: Lucas, Ana, Mia..."
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
                <p className="text-[10px] text-gray-400">Como o agente se apresenta aos clientes no WhatsApp.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  WhatsApp do Gerente (com DDI) *
                </label>
                <input
                  required
                  type="text"
                  value={form.whatsapp}
                  onChange={e => set("whatsapp", e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex: 5517991141010"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition font-mono"
                />
                <p className="text-[10px] text-gray-400">Recebe alertas de leads quentes.</p>
              </div>

              <button
                type="submit"
                className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition-all flex items-center justify-center gap-2"
              >
                Próximo <ArrowRight size={14} />
              </button>
            </form>
          )}

          {/* ── Step 2: Integração ─────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={handleFinish} className="flex flex-col gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-5">
                  Passo 2 — Integração e vitrine
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Endereço da loja
                </label>
                <input
                  type="text"
                  value={form.endereco}
                  onChange={e => set("endereco", e.target.value)}
                  placeholder="Ex: Rua das Garagens, 100 — São Paulo, SP"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-4 bg-blue-50/50 p-4 border border-blue-100 rounded-2xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">
                    Token do Webhook
                  </label>
                  <input
                    type="text"
                    value={form.webhook_token}
                    onChange={e => set("webhook_token", e.target.value.toLowerCase().replace(/\s/g, ""))}
                    placeholder="Ex: garageracing"
                    className="bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                  <p className="text-[10px] text-blue-600">
                    Configure na Avisa:{" "}
                    <strong>
                      {process.env.NEXT_PUBLIC_APP_URL || "https://seu-dominio.com"}/api/webhook/avisa?token=
                      {form.webhook_token || "SEU_TOKEN"}
                    </strong>
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">
                    Slug da Vitrine
                  </label>
                  <input
                    type="text"
                    value={form.vitrine_slug}
                    onChange={e => set("vitrine_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="Ex: garageracing"
                    className="bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                  <p className="text-[10px] text-blue-600">Pode deixar em branco e configurar depois.</p>
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest border-2 border-gray-200 text-gray-500 hover:border-gray-400 transition-all"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-red-600 text-white hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : "Entrar no Painel"}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
