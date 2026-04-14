"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";

type Step = 1 | 2 | 3;

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
    avisa_base_url: "",
    avisa_token: "",
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
            avisa_base_url: form.avisa_base_url || null,
            avisa_token: form.avisa_token || null,
          },
          { onConflict: "user_id" }
        );

      if (form.vitrine_slug) {
        fetch("/api/vitrine/seed-slug", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: form.vitrine_slug }),
        }).catch(() => {});
      }

      fetch("/api/email/boas-vindas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome_empresa: form.nome_empresa }),
      }).catch(() => {});

      // Vai direto para o upload — primeiro carro é o passo mais importante
      router.push("/upload");
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  const stepLabels = ["Identidade", "Integração", "WhatsApp Bot"];

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
            Configure sua garagem em 3 passos
          </p>
          {/* Progress */}
          <div className="flex items-center justify-center gap-2 mt-6">
            {([1, 2, 3] as const).map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black border-2 transition-all ${
                    s < step ? "bg-green-500 border-green-500 text-white" :
                    s === step ? "bg-gray-900 border-gray-900 text-white" :
                    "bg-white border-gray-200 text-gray-400"
                  }`}>
                    {s < step ? <CheckCircle2 size={14} /> : s}
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">{stepLabels[s - 1]}</span>
                </div>
                {s < 3 && <div className={`w-10 h-0.5 mb-4 ${step > s ? "bg-green-500" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">

          {/* ── Step 1: Identidade ─────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={e => { e.preventDefault(); setStep(2); }} className="flex flex-col gap-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Passo 1 — Identidade da loja
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nome da Empresa *</label>
                <input required type="text" value={form.nome_empresa}
                  onChange={e => set("nome_empresa", e.target.value)}
                  placeholder="Ex: Garage Racing"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nome do Agente IA</label>
                <input type="text" value={form.nome_agente}
                  onChange={e => set("nome_agente", e.target.value)}
                  placeholder="Ex: Lucas, Ana, Mia..."
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
                <p className="text-[10px] text-gray-400">Como o agente se apresenta aos clientes no WhatsApp.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">WhatsApp do Gerente (com DDI) *</label>
                <input required type="text" value={form.whatsapp}
                  onChange={e => set("whatsapp", e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex: 5517991141010"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition font-mono"
                />
                <p className="text-[10px] text-gray-400">Recebe alertas de leads quentes.</p>
              </div>

              <button type="submit"
                className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition-all flex items-center justify-center gap-2">
                Próximo <ArrowRight size={14} />
              </button>
            </form>
          )}

          {/* ── Step 2: Integração ─────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={e => { e.preventDefault(); setStep(3); }} className="flex flex-col gap-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Passo 2 — Integração e vitrine
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Endereço da loja</label>
                <input type="text" value={form.endereco}
                  onChange={e => set("endereco", e.target.value)}
                  placeholder="Ex: Rua das Garagens, 100 — São Paulo, SP"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-4 bg-blue-50/50 p-4 border border-blue-100 rounded-2xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">Token do Webhook</label>
                  <input type="text" value={form.webhook_token}
                    onChange={e => set("webhook_token", e.target.value.toLowerCase().replace(/\s/g, ""))}
                    placeholder="Ex: garageracing"
                    className="bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                  <p className="text-[10px] text-blue-600">
                    URL do webhook:{" "}
                    <strong>https://autozap.digital/api/webhook/avisa?token={form.webhook_token || "SEU_TOKEN"}</strong>
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">Slug da Vitrine</label>
                  <input type="text" value={form.vitrine_slug}
                    onChange={e => set("vitrine_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="Ex: garageracing"
                    className="bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                  <p className="text-[10px] text-blue-600">Pode deixar em branco e configurar depois.</p>
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest border-2 border-gray-200 text-gray-500 hover:border-gray-400 transition-all">
                  Voltar
                </button>
                <button type="submit"
                  className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition-all flex items-center justify-center gap-2">
                  Próximo <ArrowRight size={14} />
                </button>
              </div>
            </form>
          )}

          {/* ── Step 3: WhatsApp Bot (Avisa) ───────────────────────────── */}
          {step === 3 && (
            <form onSubmit={handleFinish} className="flex flex-col gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                  Passo 3 — Conectar o WhatsApp Bot
                </p>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Configure sua instância Avisa para ativar o agente de IA. Pode pular e configurar depois em <strong>Configurações</strong>.
                </p>
              </div>

              <div className="flex flex-col gap-4 bg-green-50/50 p-4 border border-green-100 rounded-2xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-green-800">URL Base da Avisa</label>
                  <input type="text" value={form.avisa_base_url}
                    onChange={e => set("avisa_base_url", e.target.value.trim())}
                    placeholder="https://www.avisaapi.com.br/api"
                    className="bg-white border border-green-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-green-800">Token da Instância Avisa</label>
                  <input type="password" value={form.avisa_token}
                    onChange={e => set("avisa_token", e.target.value.trim())}
                    placeholder="Token da sua instância"
                    className="bg-white border border-green-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
                  />
                </div>
                <p className="text-[10px] text-green-700 font-bold">
                  Encontre o token no painel da Avisa → Instâncias → sua instância → Token API.
                </p>
              </div>

              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest border-2 border-gray-200 text-gray-500 hover:border-gray-400 transition-all">
                  Voltar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-red-600 text-white hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : "Entrar no Painel"}
                </button>
              </div>

              <button type="button" onClick={() => { setForm(f => ({ ...f, avisa_base_url: "", avisa_token: "" })); handleFinish({ preventDefault: () => {} } as any); }}
                className="text-[10px] text-gray-400 hover:text-gray-600 font-black uppercase tracking-widest transition-colors text-center">
                Pular por agora →
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
