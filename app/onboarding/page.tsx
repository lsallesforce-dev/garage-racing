"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Loader2, ArrowRight, Eye, EyeOff } from "lucide-react";

type Step = 0 | 1 | 2 | 3;

const PLANO_INFO: Record<string, { nome: string; preco: string }> = {
  starter: { nome: "Starter", preco: "R$ 1.150/mês" },
  pro:     { nome: "Pro",     preco: "R$ 1.500/mês"  },
};

const stepLabels = ["Sua conta", "Identidade", "Integração", "WhatsApp"];

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const plano = params.get("plano") ?? "";
  const planoInfo = PLANO_INFO[plano];

  const [step, setStep]     = useState<Step>(0);
  const [saving, setSaving] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [showPass, setShowPass]   = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [error, setError]   = useState("");

  const [account, setAccount] = useState({ nome: "", email: "", senha: "", confirma: "" });
  const [form, setForm] = useState({
    nome_empresa: "",
    nome_agente:  "",
    whatsapp:     "",
    endereco:     "",
    vitrine_slug: "",
    meta_phone_id:     "",
    meta_access_token: "",
  });

  function setAcc(k: keyof typeof account, v: string) {
    setAccount(a => ({ ...a, [k]: v }));
  }
  function setF(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  // ── Step 0: criar conta ──────────────────────────────────────────────────────
  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (account.senha !== account.confirma) { setError("As senhas não coincidem."); return; }
    if (account.senha.length < 6)           { setError("Senha mínima de 6 caracteres."); return; }

    setSaving(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: account.email,
      password: account.senha,
      options: {
        data: { nome: account.nome },
        emailRedirectTo: `${window.location.origin}/onboarding?plano=${plano}`,
      },
    });
    setSaving(false);

    if (err) { setError(err.message); return; }

    if (data.session) {
      // confirmação de e-mail desativada → sessão imediata
      setStep(1);
    } else {
      // confirmação de e-mail ativada → aguardar confirmação
      setEmailSent(true);
    }
  }

  // ── Steps 1-3: configurar garage ────────────────────────────────────────────
  async function handleFinish(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Faça login.");

      await supabase.from("config_garage").upsert(
        {
          user_id:           user.id,
          nome_empresa:      form.nome_empresa,
          nome_agente:       form.nome_agente || "Assistente",
          whatsapp:          form.whatsapp,
          endereco:          form.endereco || null,
          vitrine_slug:      form.vitrine_slug || null,
          meta_phone_id:     form.meta_phone_id || null,
          meta_access_token: form.meta_access_token || null,
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

      router.push("/upload");
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
            <span className="text-red-600">AUTO</span>ZAP
          </h1>
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mt-1">
            {step === 0 ? "Crie sua conta — é grátis por 30 dias" : "Configure sua revenda"}
          </p>

          {/* Badge do plano */}
          {planoInfo && (
            <div className="inline-flex items-center gap-2 mt-3 px-4 py-1.5 bg-gray-900 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Plano {planoInfo.nome} · {planoInfo.preco}
            </div>
          )}

          {/* Progress — só mostra a partir do step 1 */}
          {step >= 1 && (
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
                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">
                      {stepLabels[s]}
                    </span>
                  </div>
                  {s < 3 && <div className={`w-10 h-0.5 mb-4 ${step > s ? "bg-green-500" : "bg-gray-200"}`} />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">

          {/* ── Step 0: Criar conta ──────────────────────────────────────── */}
          {step === 0 && !emailSent && (
            <form onSubmit={handleCreateAccount} className="flex flex-col gap-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                Passo 1 — Criar sua conta
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Seu nome *</label>
                <input required type="text" value={account.nome}
                  onChange={e => setAcc("nome", e.target.value)}
                  placeholder="Ex: Lucas Salles"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">E-mail *</label>
                <input required type="email" value={account.email}
                  onChange={e => setAcc("email", e.target.value)}
                  placeholder="voce@email.com"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Senha *</label>
                <div className="relative">
                  <input required type={showPass ? "text" : "password"} value={account.senha}
                    onChange={e => setAcc("senha", e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                  />
                  <button type="button" onClick={() => setShowPass(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Confirmar senha *</label>
                <div className="relative">
                  <input required type={showConf ? "text" : "password"} value={account.confirma}
                    onChange={e => setAcc("confirma", e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                  />
                  <button type="button" onClick={() => setShowConf(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showConf ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  <p className="text-red-600 text-[11px] font-bold text-center">{error}</p>
                </div>
              )}

              <button type="submit" disabled={saving}
                className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                {saving ? <><Loader2 size={14} className="animate-spin" /> Criando conta...</> : <>Criar conta <ArrowRight size={14} /></>}
              </button>

              <div className="text-center pt-1">
                <span className="text-[10px] text-gray-400">Já tem conta? </span>
                <a href="/login" className="text-[10px] text-red-600 hover:text-red-700 font-black uppercase tracking-widest transition">
                  Entrar
                </a>
              </div>
            </form>
          )}

          {/* ── Aguardando confirmação de e-mail ────────────────────────── */}
          {step === 0 && emailSent && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <p className="text-[13px] font-black uppercase tracking-widest text-gray-900">
                Verifique seu e-mail
              </p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
                Enviamos um link de confirmação para <strong>{account.email}</strong>.
                Clique no link e volte aqui para configurar sua revenda.
              </p>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                Após confirmar, faça login em{" "}
                <a href="/login" className="text-red-600 hover:underline">autozap.digital/login</a>
              </p>
            </div>
          )}

          {/* ── Step 1: Identidade ──────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={e => { e.preventDefault(); setStep(2); }} className="flex flex-col gap-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Passo 2 — Identidade da loja
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nome da Empresa *</label>
                <input required type="text" value={form.nome_empresa}
                  onChange={e => setF("nome_empresa", e.target.value)}
                  placeholder="Ex: Garage Racing"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nome do Agente IA</label>
                <input type="text" value={form.nome_agente}
                  onChange={e => setF("nome_agente", e.target.value)}
                  placeholder="Ex: Lucas, Ana, Mia..."
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
                <p className="text-[10px] text-gray-400">Como o agente se apresenta aos clientes no WhatsApp.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">WhatsApp do Gerente (com DDI) *</label>
                <input required type="text" value={form.whatsapp}
                  onChange={e => setF("whatsapp", e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex: 5517991141010"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition font-mono"
                />
              </div>

              <button type="submit"
                className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition-all flex items-center justify-center gap-2">
                Próximo <ArrowRight size={14} />
              </button>
            </form>
          )}

          {/* ── Step 2: Integração ──────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={e => { e.preventDefault(); setStep(3); }} className="flex flex-col gap-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Passo 3 — Integração e vitrine
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Endereço da loja</label>
                <input type="text" value={form.endereco}
                  onChange={e => setF("endereco", e.target.value)}
                  placeholder="Ex: Rua das Garagens, 100 — São Paulo, SP"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5 bg-blue-50/50 p-4 border border-blue-100 rounded-2xl">
                <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">Slug da Vitrine</label>
                <input type="text" value={form.vitrine_slug}
                  onChange={e => setF("vitrine_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="Ex: garageracing"
                  className="bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
                <p className="text-[10px] text-blue-600">
                  Vitrine pública:{" "}
                  <strong>{form.vitrine_slug ? `${form.vitrine_slug}.autozap.digital` : "SEU_SLUG.autozap.digital"}</strong>
                  {" "}· Pode deixar em branco e configurar depois.
                </p>
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

          {/* ── Step 3: WhatsApp Business ────────────────────────────────── */}
          {step === 3 && (
            <form onSubmit={handleFinish} className="flex flex-col gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                  Passo 4 — Conectar WhatsApp Business
                </p>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Conecte seu número via <strong>Meta WhatsApp Cloud API</strong>. Pode pular e configurar depois em <strong>Configurações</strong>.
                </p>
              </div>

              <div className="flex flex-col gap-4 bg-blue-50/50 p-4 border border-blue-100 rounded-2xl">
                <p className="text-[10px] text-blue-600">
                  Configure o webhook no <strong>Meta for Developers</strong>:
                  <br />URL: <strong className="font-mono">https://autozap.digital/api/webhook/meta</strong>
                  <br />Token: <strong className="font-mono">autozap_webhook_2026</strong>
                </p>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-blue-800">Phone Number ID</label>
                  <input type="text" value={form.meta_phone_id}
                    onChange={e => setF("meta_phone_id", e.target.value.trim())}
                    placeholder="Ex: 390538797515329"
                    className="bg-white border border-blue-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  />
                </div>
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

              <button type="button"
                onClick={() => handleFinish({ preventDefault: () => {} } as any)}
                className="text-[10px] text-gray-400 hover:text-gray-600 font-black uppercase tracking-widest transition-colors text-center">
                Pular por agora →
              </button>
            </form>
          )}

        </div>

        <p className="text-center text-[10px] text-gray-400 mt-6 uppercase tracking-widest">
          AutoZap © {new Date().getFullYear()} · Trial de 30 dias sem cartão
        </p>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
