"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NovaSenhaPage() {
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [temSessao, setTemSessao] = useState<boolean | null>(null);

  // A sessão de recuperação já vem em cookie (setada pelo callback). Sem ela o
  // updateUser não teria em quem mexer — melhor avisar antes de mostrar o form.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setTemSessao(!!data.user));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 6) {
      setErro("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirma) {
      setErro("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setLoading(false);
    if (error) {
      setErro("Não foi possível salvar a senha. Peça um novo link.");
      return;
    }
    window.location.href = "/dashboard";
  }

  const inputCls =
    "w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition";

  return (
    <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <h1 className="text-4xl font-black tracking-tighter italic">
            <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
          </h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="mb-6">
            <h2 className="text-[13px] font-black uppercase tracking-[0.2em] text-gray-900">Nova Senha</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Escolha a senha que você vai usar de agora em diante</p>
          </div>

          {temSessao === false ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Este link expirou ou já foi usado. Peça um novo em &quot;Esqueci minha senha&quot;.
              </p>
              <a href="/login"
                className="w-full bg-gray-900 hover:bg-red-600 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition text-center">
                Voltar ao login
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nova senha</label>
                <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Confirmar senha</label>
                <input type="password" required value={confirma} onChange={(e) => setConfirma(e.target.value)}
                  placeholder="••••••••" className={inputCls} />
              </div>

              {erro && <p className="text-[11px] font-bold text-red-600">{erro}</p>}

              <button type="submit" disabled={loading || temSessao === null}
                className="w-full bg-gray-900 hover:bg-red-600 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition">
                {loading ? "Salvando..." : "Salvar senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
