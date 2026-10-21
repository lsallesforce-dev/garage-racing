"use client";

// Porta das Configurações: só monta a página (e só busca token, chave e acesso
// de banco) depois da senha da loja — a mesma do olho do Financeiro. O
// servidor grava um cookie de 30 min (lib/senha-loja); as rotas sensíveis
// conferem esse cookie, então a trava não depende só desta tela.

import { useEffect, useState } from "react";
import { Lock, Loader2 } from "lucide-react";

const RECHECAR_MS = 2 * 60 * 1000;

export function TravaConfiguracoes({ children }: { children: React.ReactNode }) {
  // null = perguntando ao servidor
  const [estado, setEstado] = useState<{ definida: boolean; desbloqueado: boolean } | null>(null);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [checando, setChecando] = useState(false);

  async function consultar() {
    const r = await fetch("/api/configuracoes/desbloqueio", { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => null);
    setEstado(r?.ok && j ? j : { definida: true, desbloqueado: false });
  }

  useEffect(() => { consultar(); }, []);

  // O cookie vence em 30 min: a tela tranca junto, sem precisar recarregar.
  useEffect(() => {
    if (!estado?.desbloqueado) return;
    const t = setInterval(consultar, RECHECAR_MS);
    return () => clearInterval(t);
  }, [estado?.desbloqueado]);

  const criando = estado?.definida === false;

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!senha || checando) return;
    if (criando) {
      if (senha.length < 4) { setErro("Use pelo menos 4 caracteres"); return; }
      if (senha !== confirma) { setErro("As duas senhas não são iguais"); setConfirma(""); return; }
    }
    setChecando(true); setErro("");
    const r = await fetch("/api/configuracoes/desbloqueio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    }).catch(() => null);
    const j = await r?.json().catch(() => null);
    setChecando(false);
    setSenha(""); setConfirma("");
    if (r?.ok) { setEstado({ definida: true, desbloqueado: true }); return; }
    if (r?.status === 409) setEstado({ definida: true, desbloqueado: false });
    setErro(j?.error || (criando ? "Não foi possível salvar" : "Senha incorreta"));
  }

  async function trancar() {
    await fetch("/api/configuracoes/desbloqueio", { method: "DELETE" }).catch(() => null);
    setEstado((s) => (s ? { ...s, desbloqueado: false } : s));
  }

  if (!estado) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-gray-400" size={20} /></div>;
  }

  if (estado.desbloqueado) {
    return (
      <>
        <button
          onClick={trancar}
          className="fixed top-4 right-4 z-40 flex items-center gap-1.5 bg-white border border-gray-200 shadow-sm rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-600 hover:text-gray-900"
        >
          <Lock size={12} /> Trancar
        </button>
        {children}
      </>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <form onSubmit={entrar} className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gray-900 rounded-xl flex items-center justify-center">
            <Lock size={15} className="text-white" />
          </div>
          <div>
            <p className="font-black uppercase italic tracking-tight text-gray-900 leading-tight">
              {criando ? "Criar senha da loja" : "Configurações"}
            </p>
            <p className="text-[10px] text-gray-400">
              {criando
                ? "Vale pras Configurações e pro olho do Financeiro"
                : "Digite a senha da loja (a mesma do Financeiro)"}
            </p>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete={criando ? "new-password" : "current-password"}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px]"
          placeholder={criando ? "Nova senha" : "Senha"}
          value={senha}
          onChange={(e) => { setSenha(e.target.value); setErro(""); }}
        />
        {criando && (
          <input
            type="password"
            autoComplete="new-password"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px]"
            placeholder="Repita a senha"
            value={confirma}
            onChange={(e) => { setConfirma(e.target.value); setErro(""); }}
          />
        )}
        {erro && <p className="text-[11px] text-red-600">{erro}</p>}
        <button
          type="submit"
          disabled={checando || !senha}
          className="w-full bg-gray-900 text-white rounded-xl py-2.5 text-[11px] font-black uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {checando && <Loader2 size={12} className="animate-spin" />}
          {criando ? "Criar e entrar" : "Entrar"}
        </button>
        <p className="text-[10px] text-gray-400 text-center">
          Esqueceu? Fale com o suporte do AutoZap pra resetar.
        </p>
      </form>
    </div>
  );
}
