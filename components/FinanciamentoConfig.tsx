"use client";

// Aba "Financiamento" das Configurações: liga a simulação automática e guarda
// o acesso da loja ao portal de cada banco (app/api/financiamento/bancos).
// A senha nunca volta do servidor — salvo, o banco mostra só "salvo ✓".

import { useEffect, useState } from "react";
import { Landmark, Loader2, CheckCircle2, Trash2, Eye, EyeOff, AlertTriangle } from "lucide-react";

type BancoSalvo = { banco: string; usuario_dica: string | null; ativo: boolean; ultimo_status: string | null; retorno_pct: number | null };
type Disp = { banco: string; disponivel_agora: boolean; motivo: string | null; horario: string };
type Estado = { ligado: boolean; servico: boolean; bancos: BancoSalvo[]; lista: string[]; disponibilidade: Disp[] };

const STATUS: Record<string, { txt: string; cor: string }> = {
  aprovado: { txt: "funcionando", cor: "text-green-700 bg-green-100" },
  recusado: { txt: "funcionando", cor: "text-green-700 bg-green-100" },
  simulacao: { txt: "funcionando", cor: "text-green-700 bg-green-100" },
  credencial_invalida: { txt: "usuário/senha incorretos", cor: "text-red-700 bg-red-100" },
  credencial_restricao: { txt: "acesso com restrição", cor: "text-amber-700 bg-amber-100" },
};

export function FinanciamentoConfig() {
  const [st, setSt] = useState<Estado | null>(null);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const r = await fetch("/api/financiamento/bancos", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Não foi possível carregar"); return; }
    setSt(j);
  }
  useEffect(() => { carregar(); }, []);

  async function enviar(body: Record<string, unknown>, metodo = "POST") {
    setSalvando(true); setErro("");
    const url = metodo === "DELETE" ? `/api/financiamento/bancos?banco=${encodeURIComponent(String(body.banco))}` : "/api/financiamento/bancos";
    const r = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: metodo === "DELETE" ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) { setErro(j.error ?? "Erro ao salvar"); return false; }
    await carregar();
    return true;
  }

  async function salvarBanco(banco: string) {
    if (await enviar({ banco, usuario, senha })) {
      setEditando(null); setUsuario(""); setSenha(""); setVerSenha(false);
    }
  }

  if (!st) {
    return (
      <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8 text-[11px] text-gray-500">
        {erro || <Loader2 size={16} className="animate-spin" />}
      </div>
    );
  }

  const salvos = new Map(st.bancos.map((b) => [b.banco, b]));
  const disp = new Map(st.disponibilidade.map((d) => [d.banco, d]));
  const algumAtivo = st.bancos.some((b) => b.ativo);

  return (
    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
      <div className="flex items-center gap-3 mb-1">
        <Landmark size={18} className="text-emerald-600" />
        <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Simulação de financiamento</h2>
      </div>
      <p className="text-[11px] text-gray-500 mb-6">
        Quando o cliente passa entrada, CPF e data de nascimento no WhatsApp, a IA consulta os bancos abaixo com o acesso
        da sua loja e manda as melhores condições pré-aprovadas pra ele. Você recebe o resultado completo pra fechar.
      </p>

      {!st.servico && (
        <p className="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 rounded-xl p-3 mb-4">
          <AlertTriangle size={14} /> Serviço de simulação ainda não ativado no AutoZap.
        </p>
      )}

      <label className="flex items-center justify-between gap-4 bg-gray-50 rounded-2xl p-4 mb-6">
        <span>
          <span className="block text-[11px] font-black text-gray-800">Simular automaticamente</span>
          <span className="block text-[10px] text-gray-500">
            {algumAtivo ? "Desligado, o pedido vai pro gerente como hoje." : "Cadastre o acesso de pelo menos um banco pra ligar."}
          </span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-emerald-600"
          checked={st.ligado}
          disabled={salvando || (!st.ligado && !algumAtivo)}
          onChange={(e) => enviar({ ligado: e.target.checked })}
        />
      </label>

      <div className="flex flex-col divide-y divide-gray-100">
        {st.lista.map((banco) => {
          const s = salvos.get(banco);
          const d = disp.get(banco);
          const status = s?.ultimo_status ? STATUS[s.ultimo_status] : null;
          return (
            <div key={banco} className="py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[12px] font-black text-gray-800 min-w-[110px]">{banco}</span>
                {s ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-700">
                    <CheckCircle2 size={12} /> salvo ({s.usuario_dica}…)
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-400">não cadastrado</span>
                )}
                {status && <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${status.cor}`}>{status.txt}</span>}
                {d && !d.disponivel_agora && <span className="text-[9px] text-gray-400">fora do horário ({d.horario})</span>}
                <span className="ml-auto flex items-center gap-2">
                  {s && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-500" title="% de retorno da sua tabela nesse banco — só pra estimar a comissão, o cliente não vê">
                      retorno
                      <input
                        key={`${banco}-${s.retorno_pct ?? ""}`}
                        className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-[11px] text-right"
                        defaultValue={s.retorno_pct ?? ""}
                        placeholder="—"
                        inputMode="decimal"
                        disabled={salvando}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== String(s.retorno_pct ?? "")) enviar({ banco, retorno_pct: v === "" ? null : v });
                        }}
                      />
                      %
                    </label>
                  )}
                  {s && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-500">
                      <input type="checkbox" className="accent-emerald-600" checked={s.ativo} disabled={salvando}
                        onChange={(e) => enviar({ banco, ativo: e.target.checked })} />
                      usar
                    </label>
                  )}
                  <button
                    className="text-[10px] font-black uppercase tracking-wider text-gray-600 hover:text-gray-900"
                    onClick={() => { setEditando(editando === banco ? null : banco); setUsuario(""); setSenha(""); }}
                  >
                    {s ? "Trocar acesso" : "Cadastrar"}
                  </button>
                  {s && (
                    <button aria-label={`Remover ${banco}`} className="text-gray-400 hover:text-red-600" disabled={salvando}
                      onClick={() => enviar({ banco }, "DELETE")}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
              {editando === banco && (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-[12px]"
                    placeholder={`Usuário do portal ${banco}`}
                    autoComplete="off"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                  />
                  <div className="flex-1 relative">
                    <input
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 pr-9 text-[12px]"
                      placeholder="Senha"
                      type={verSenha ? "text" : "password"}
                      autoComplete="new-password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                    />
                    <button type="button" className="absolute right-2 top-2 text-gray-400" onClick={() => setVerSenha(!verSenha)}>
                      {verSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    className="bg-gray-900 text-white rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                    disabled={salvando || !usuario || !senha}
                    onClick={() => salvarBanco(banco)}
                  >
                    {salvando ? <Loader2 size={12} className="animate-spin" /> : "Salvar"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {erro && <p className="text-[11px] text-red-600 mt-4">{erro}</p>}
      <p className="text-[10px] text-gray-400 mt-6">
        Use o mesmo usuário e senha que você usa pra entrar no portal de cada banco. A senha fica cifrada e não aparece de novo
        aqui.
      </p>
      <p className="text-[10px] text-gray-400 mt-2">
        <b>Retorno:</b> o % que o banco paga à loja na tabela do seu login (ex.: 4 na R4). Os bancos não informam isso na
        simulação: o AutoZap estima valor financiado × %, mostra pra você e pro gerente, e nunca pro cliente.
      </p>
    </div>
  );
}
