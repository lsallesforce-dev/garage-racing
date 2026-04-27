"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Loader2, Save, KeyRound, Mail, Zap, CreditCard, Clock, AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

interface PlanoInfo {
  plano: string;
  plano_ativo: boolean;
  trial_ends_at: string | null;
  plano_vence_em: string | null;
}

function diasRestantes(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export default function MinhaContaPage() {
  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [savedEmail, setSavedEmail] = useState(false);
  const [erroEmail, setErroEmail] = useState<string | null>(null);

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [savingSenha, setSavingSenha] = useState(false);
  const [savedSenha, setSavedSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);

  const [planoInfo, setPlanoInfo] = useState<PlanoInfo | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("plano, plano_ativo, trial_ends_at, plano_vence_em")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => { if (data) setPlanoInfo(data as PlanoInfo); });
    });
  }, []);

  const handleSaveEmail = async () => {
    if (!email.trim()) return;
    setSavingEmail(true);
    setErroEmail(null);
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      setSavedEmail(true);
      setEmail("");
      setTimeout(() => setSavedEmail(false), 4000);
    } catch (e: any) {
      setErroEmail(e.message || "Erro ao atualizar e-mail.");
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSaveSenha = async () => {
    setErroSenha(null);
    if (!novaSenha || !confirmaSenha) { setErroSenha("Preencha todos os campos."); return; }
    if (novaSenha.length < 6) { setErroSenha("A senha deve ter no mínimo 6 caracteres."); return; }
    if (novaSenha !== confirmaSenha) { setErroSenha("As senhas não coincidem."); return; }
    setSavingSenha(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;
      setSavedSenha(true);
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmaSenha("");
      setTimeout(() => setSavedSenha(false), 4000);
    } catch (e: any) {
      setErroSenha(e.message || "Erro ao atualizar senha.");
    } finally {
      setSavingSenha(false);
    }
  };

  return (
    <main className="flex-1 p-10 bg-[#efefed] min-h-screen">
      <header className="mb-10 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
          Minha Conta
        </h1>
        <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">
          E-mail e senha de acesso
        </p>
      </header>

      <div className="max-w-2xl flex flex-col gap-6">

        {/* ── Plano Atual ── */}
        {planoInfo && (() => {
          const agora = new Date();
          const planoAtivo = planoInfo.plano_ativo && planoInfo.plano_vence_em && new Date(planoInfo.plano_vence_em) > agora;
          const trialAtivo = !planoAtivo && planoInfo.trial_ends_at && new Date(planoInfo.trial_ends_at) > agora;
          const expirado   = !planoAtivo && !trialAtivo;
          const diasPlano  = diasRestantes(planoAtivo ? planoInfo.plano_vence_em : planoInfo.trial_ends_at);
          const nomePlano  = (planoInfo.plano ?? "pro").charAt(0).toUpperCase() + (planoInfo.plano ?? "pro").slice(1);

          return (
            <div className={`bg-white rounded-[2rem] border shadow-sm p-8 ${expirado ? "border-red-200" : "border-gray-100"}`}>
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${planoAtivo ? "bg-blue-50" : trialAtivo ? "bg-purple-50" : "bg-red-50"}`}>
                  {planoAtivo ? <CreditCard size={16} className="text-blue-600" /> :
                   trialAtivo ? <Clock size={16} className="text-purple-600" /> :
                                <AlertTriangle size={16} className="text-red-600" />}
                </div>
                <div>
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Meu Plano</h2>
                  <p className="text-[10px] text-gray-400 mt-0.5">Situação atual da sua assinatura</p>
                </div>
              </div>

              <div className="flex items-center justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={14} className={planoAtivo ? "text-blue-600" : trialAtivo ? "text-purple-600" : "text-red-500"} />
                    <span className="text-xl font-black uppercase italic tracking-tighter text-gray-900">
                      Plano {nomePlano}
                    </span>
                  </div>
                  {planoAtivo && (
                    <p className="text-sm text-gray-500">
                      Ativo até <span className="font-bold text-gray-700">{new Date(planoInfo.plano_vence_em!).toLocaleDateString("pt-BR")}</span>
                      {" · "}<span className="text-blue-600 font-bold">{diasPlano} dias restantes</span>
                    </p>
                  )}
                  {trialAtivo && (
                    <p className="text-sm text-gray-500">
                      Trial até <span className="font-bold text-gray-700">{new Date(planoInfo.trial_ends_at!).toLocaleDateString("pt-BR")}</span>
                      {" · "}<span className="text-purple-600 font-bold">{diasPlano} dias restantes</span>
                    </p>
                  )}
                  {expirado && (
                    <p className="text-sm text-red-600 font-bold">Plano expirado — assine para reativar</p>
                  )}
                </div>

                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                  planoAtivo  ? "bg-blue-50 text-blue-700 border-blue-100" :
                  trialAtivo  ? "bg-purple-50 text-purple-700 border-purple-100" :
                                "bg-red-50 text-red-700 border-red-100"
                }`}>
                  {planoAtivo ? "Ativo" : trialAtivo ? "Trial" : "Expirado"}
                </span>
              </div>

              <Link href={`/assinar?plano=${planoInfo.plano ?? "pro"}`}
                className="w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-blue-600">
                {planoAtivo ? "Renovar / Mudar plano" : expirado ? "Reativar agora" : "Assinar agora"}
                <ArrowRight size={13} />
              </Link>
            </div>
          );
        })()}

        {/* ── Alterar E-mail ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Mail size={16} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Alterar E-mail</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">Um link de confirmação será enviado para o novo endereço.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Novo E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErroEmail(null); setSavedEmail(false); }}
                placeholder="novo@email.com"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            {erroEmail && (
              <p className="text-[11px] font-bold text-red-600 bg-red-50 rounded-xl px-4 py-2">{erroEmail}</p>
            )}

            {savedEmail && (
              <p className="text-[11px] font-bold text-green-700 bg-green-50 rounded-xl px-4 py-2">
                Verifique sua caixa de entrada — enviamos um link de confirmação.
              </p>
            )}

            <button
              onClick={handleSaveEmail}
              disabled={savingEmail || !email.trim()}
              className="w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-blue-600 disabled:opacity-40"
            >
              {savingEmail ? (
                <><Loader2 size={16} className="animate-spin" /> Salvando...</>
              ) : (
                <><Save size={14} /> Atualizar E-mail</>
              )}
            </button>
          </div>
        </div>

        {/* ── Alterar Senha ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <KeyRound size={16} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Alterar Senha</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">Mínimo de 6 caracteres.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Nova Senha
              </label>
              <input
                type="password"
                value={novaSenha}
                onChange={e => { setNovaSenha(e.target.value); setErroSenha(null); setSavedSenha(false); }}
                placeholder="••••••••"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Confirmar Nova Senha
              </label>
              <input
                type="password"
                value={confirmaSenha}
                onChange={e => { setConfirmaSenha(e.target.value); setErroSenha(null); setSavedSenha(false); }}
                placeholder="••••••••"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 transition"
              />
            </div>

            {erroSenha && (
              <p className="text-[11px] font-bold text-red-600 bg-red-50 rounded-xl px-4 py-2">{erroSenha}</p>
            )}

            {savedSenha && (
              <p className="text-[11px] font-bold text-green-700 bg-green-50 rounded-xl px-4 py-2 flex items-center gap-2">
                <CheckCircle2 size={14} /> Senha atualizada com sucesso!
              </p>
            )}

            <button
              onClick={handleSaveSenha}
              disabled={savingSenha || !novaSenha || !confirmaSenha}
              className="w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-amber-600 disabled:opacity-40"
            >
              {savingSenha ? (
                <><Loader2 size={16} className="animate-spin" /> Salvando...</>
              ) : (
                <><Save size={14} /> Atualizar Senha</>
              )}
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}
