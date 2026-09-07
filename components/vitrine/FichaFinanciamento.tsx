"use client";

// Ficha de financiamento da vitrine pública.
//
// Substitui o antigo "simulador", que fazia (preço - entrada) / parcelas e
// mostrava o resultado como estimativa de parcela. Sem juros, IOF e tarifas o
// número saía muito abaixo do que qualquer banco aprova — o cliente chegava na
// loja ancorado numa parcela que não existe. Aqui não se calcula nada: coleta
// os dados que o banco pede na proposta de crédito (CDC) e manda pro gerente.
//
// Um único componente para a listagem e a página de detalhe — duas cópias
// divergiriam no primeiro campo novo que o banco passar a exigir.

import { useState } from "react";
import { X, ChevronRight, ChevronLeft, Check, ShieldCheck, Loader2, MessageCircle } from "lucide-react";

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const soDigitos = (s: string) => s.replace(/\D/g, "");

const mascaraCPF = (s: string) =>
  soDigitos(s).slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

const mascaraTel = (s: string) => {
  const d = soDigitos(s).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

const mascaraCEP = (s: string) => soDigitos(s).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

const mascaraDinheiro = (s: string) => {
  const d = soDigitos(s).slice(0, 9);
  return d ? Number(d).toLocaleString("pt-BR") : "";
};

/** Mesmo cálculo de DV que a rota faz no servidor — evita mandar ficha que já nasce recusada. */
function cpfValido(raw: string): boolean {
  const cpf = soDigitos(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const peso of [10, 11]) {
    let soma = 0;
    for (let i = 0; i < peso - 1; i++) soma += Number(cpf[i]) * (peso - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[peso - 1])) return false;
  }
  return true;
}

export interface VeiculoFicha {
  id?: string | null;
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  ano_modelo?: number | string | null;
  preco_sugerido?: number | null;
}

interface Props {
  tenant: string;
  veiculo: VeiculoFicha;
  nomeEmpresa: string;
  whatsapp: string;
  onClose: () => void;
}

const ESTADO_CIVIL = [
  ["solteiro", "Solteiro(a)"],
  ["casado", "Casado(a)"],
  ["uniao", "União estável"],
  ["divorciado", "Divorciado(a)"],
  ["viuvo", "Viúvo(a)"],
];

const VINCULOS = [
  ["clt", "CLT (carteira assinada)"],
  ["autonomo", "Autônomo / MEI"],
  ["empresario", "Empresário / sócio"],
  ["servidor", "Servidor público"],
  ["aposentado", "Aposentado / pensionista"],
  ["outro", "Outro"],
];

export default function FichaFinanciamento({ tenant, veiculo, nomeEmpresa, whatsapp, onClose }: Props) {
  const preco = veiculo.preco_sugerido ?? 0;
  const titulo = [veiculo.marca, veiculo.modelo].filter(Boolean).join(" ");

  const [passo, setPasso] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  const [f, setF] = useState({
    nome: "", cpf: "", nascimento: "", nomeMae: "", estadoCivil: "", telefone: "", email: "", cep: "",
    ocupacao: "", vinculo: "", rendaMensal: "", tempoEmprego: "",
    entrada: "", prazo: "48", restricao: "", troca: "", observacao: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const passo1Ok =
    f.nome.trim().split(/\s+/).filter(Boolean).length >= 2 &&
    cpfValido(f.cpf) &&
    /^\d{4}-\d{2}-\d{2}$/.test(f.nascimento) &&
    soDigitos(f.telefone).length >= 10;

  const passo2Ok = !!f.vinculo && soDigitos(f.rendaMensal).length > 0;

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/vitrine/${encodeURIComponent(tenant)}/financiamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          cpf: soDigitos(f.cpf),
          telefone: soDigitos(f.telefone),
          cep: soDigitos(f.cep),
          rendaMensal: soDigitos(f.rendaMensal),
          entrada: soDigitos(f.entrada),
          veiculoId: veiculo.id ?? null,
          veiculoDesc: [titulo, veiculo.versao, veiculo.ano_modelo].filter(Boolean).join(" "),
          preco,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Não consegui enviar sua ficha. Tente de novo.");
      setPronto(true);
    } catch (e: any) {
      setErro(e?.message ?? "Falha de conexão. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const msgWa =
    `Olá! Acabei de enviar minha ficha de financiamento do *${[titulo, veiculo.ano_modelo].filter(Boolean).join(" ")}* ` +
    `no site da ${nomeEmpresa}. Meu nome é ${f.nome.trim() || "—"}.`;
  const waHref = `https://wa.me/${soDigitos(whatsapp).replace(/^(?!55)/, "55")}?text=${encodeURIComponent(msgWa)}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        style={{ colorScheme: "light" }}
        className="bg-white text-gray-900 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Cabeçalho ── */}
        <div className="sticky top-0 bg-white px-6 pt-6 pb-4 border-b border-gray-100 z-10">
          <div className="flex justify-between items-start">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                Proposta de financiamento
              </p>
              <h3 className="text-lg font-black uppercase italic tracking-tight truncate">{titulo}</h3>
              {preco > 0 && (
                <p className="text-sm font-black tracking-tighter text-[var(--brand)] mt-0.5">{fmtBRL(preco)}</p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="w-8 h-8 shrink-0 bg-gray-100 rounded-full grid place-items-center hover:bg-gray-200 transition"
            >
              <X size={14} />
            </button>
          </div>

          {!pronto && (
            <div className="flex gap-1.5 mt-4">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`h-1 flex-1 rounded-full transition ${n <= passo ? "bg-[var(--brand)]" : "bg-gray-200"}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 pt-5">
          {pronto ? (
            /* ── Sucesso ── */
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center mx-auto mb-4">
                <Check size={26} strokeWidth={3} />
              </div>
              <h4 className="text-lg font-black uppercase italic tracking-tight mb-2">Ficha enviada!</h4>
              <p className="text-sm text-gray-500 leading-snug mb-6">
                O time da {nomeEmpresa} já recebeu seus dados e vai levar sua proposta aos bancos parceiros.
                Em breve entram em contato com as condições reais — taxa, entrada e parcela aprovadas.
              </p>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition active:scale-[0.98]"
              >
                <MessageCircle size={16} /> Falar agora no WhatsApp
              </a>
              <button
                onClick={onClose}
                className="w-full mt-2 py-3 text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 transition"
              >
                Fechar
              </button>
            </div>
          ) : (
            <>
              {/* ── Passo 1: dados pessoais ── */}
              {passo === 1 && (
                <div className="space-y-4">
                  <p className="text-[11px] text-gray-500 leading-snug">
                    Preencha como está no documento — é o que o banco usa na análise.
                  </p>
                  <Campo label="Nome completo" obrigatorio>
                    <input
                      type="text" autoComplete="name" placeholder="Ex: João da Silva Souza"
                      value={f.nome} onChange={(e) => set("nome", e.target.value)} className={inputCls}
                    />
                  </Campo>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="CPF" obrigatorio>
                      <input
                        type="text" inputMode="numeric" placeholder="000.000.000-00"
                        value={f.cpf} onChange={(e) => set("cpf", mascaraCPF(e.target.value))}
                        className={`${inputCls} ${f.cpf.length === 14 && !cpfValido(f.cpf) ? "border-red-400" : ""}`}
                      />
                    </Campo>
                    <Campo label="Nascimento" obrigatorio>
                      <input
                        type="date" value={f.nascimento} onChange={(e) => set("nascimento", e.target.value)}
                        className={inputCls}
                      />
                    </Campo>
                  </div>
                  <Campo label="WhatsApp" obrigatorio>
                    <input
                      type="tel" inputMode="numeric" autoComplete="tel" placeholder="(17) 99999-9999"
                      value={f.telefone} onChange={(e) => set("telefone", mascaraTel(e.target.value))} className={inputCls}
                    />
                  </Campo>
                  <Campo label="Nome completo da mãe">
                    <input
                      type="text" placeholder="Ex: Maria Aparecida Souza"
                      value={f.nomeMae} onChange={(e) => set("nomeMae", e.target.value)} className={inputCls}
                    />
                  </Campo>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Estado civil">
                      <select value={f.estadoCivil} onChange={(e) => set("estadoCivil", e.target.value)} className={inputCls}>
                        <option value="">Selecione</option>
                        {ESTADO_CIVIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Campo>
                    <Campo label="CEP">
                      <input
                        type="text" inputMode="numeric" placeholder="00000-000"
                        value={f.cep} onChange={(e) => set("cep", mascaraCEP(e.target.value))} className={inputCls}
                      />
                    </Campo>
                  </div>
                  <Campo label="E-mail">
                    <input
                      type="email" autoComplete="email" placeholder="voce@email.com"
                      value={f.email} onChange={(e) => set("email", e.target.value)} className={inputCls}
                    />
                  </Campo>
                </div>
              )}

              {/* ── Passo 2: renda ── */}
              {passo === 2 && (
                <div className="space-y-4">
                  <p className="text-[11px] text-gray-500 leading-snug">
                    A renda é o que define o prazo e a parcela que o banco aprova.
                  </p>
                  <Campo label="Profissão / ocupação">
                    <input
                      type="text" placeholder="Ex: Vendedor, motorista, autônomo"
                      value={f.ocupacao} onChange={(e) => set("ocupacao", e.target.value)} className={inputCls}
                    />
                  </Campo>
                  <Campo label="Tipo de vínculo" obrigatorio>
                    <select value={f.vinculo} onChange={(e) => set("vinculo", e.target.value)} className={inputCls}>
                      <option value="">Selecione</option>
                      {VINCULOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Campo>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Renda mensal (R$)" obrigatorio>
                      <input
                        type="text" inputMode="numeric" placeholder="3.500"
                        value={f.rendaMensal} onChange={(e) => set("rendaMensal", mascaraDinheiro(e.target.value))}
                        className={inputCls}
                      />
                    </Campo>
                    <Campo label="Tempo no trabalho">
                      <input
                        type="text" placeholder="Ex: 2 anos"
                        value={f.tempoEmprego} onChange={(e) => set("tempoEmprego", e.target.value)} className={inputCls}
                      />
                    </Campo>
                  </div>
                </div>
              )}

              {/* ── Passo 3: condições ── */}
              {passo === 3 && (
                <div className="space-y-4">
                  <Campo label="Valor de entrada (R$)">
                    <input
                      type="text" inputMode="numeric" placeholder="Ex: 15.000"
                      value={f.entrada} onChange={(e) => set("entrada", mascaraDinheiro(e.target.value))} className={inputCls}
                    />
                  </Campo>
                  <Campo label="Prazo desejado">
                    <div className="grid grid-cols-6 gap-1.5">
                      {[12, 24, 36, 48, 60, 72].map((n) => (
                        <button
                          key={n} type="button" onClick={() => set("prazo", String(n))}
                          className={`py-2 rounded-lg text-[11px] font-black transition ${
                            f.prazo === String(n)
                              ? "bg-[var(--brand)] text-[var(--brand-fg)]"
                              : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                          }`}
                        >
                          {n}x
                        </button>
                      ))}
                    </div>
                  </Campo>
                  <Campo label="Tem restrição no CPF?">
                    <div className="grid grid-cols-3 gap-1.5">
                      {[["nao", "Não"], ["sim", "Sim"], ["nao_sei", "Não sei"]].map(([v, l]) => (
                        <button
                          key={v} type="button" onClick={() => set("restricao", v)}
                          className={`py-2.5 rounded-lg text-[11px] font-black transition ${
                            f.restricao === v
                              ? "bg-[var(--brand)] text-[var(--brand-fg)]"
                              : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </Campo>
                  <Campo label="Tem carro na troca?">
                    <input
                      type="text" placeholder="Ex: Onix 2018, 80 mil km — ou deixe em branco"
                      value={f.troca} onChange={(e) => set("troca", e.target.value)} className={inputCls}
                    />
                  </Campo>
                  <Campo label="Observação">
                    <textarea
                      rows={2} placeholder="Algo que a loja precise saber?"
                      value={f.observacao} onChange={(e) => set("observacao", e.target.value)}
                      className={`${inputCls} resize-none`}
                    />
                  </Campo>
                  <p className="flex items-start gap-2 text-[10px] text-gray-400 leading-snug">
                    <ShieldCheck size={13} className="shrink-0 mt-0.5 text-[var(--brand)]" />
                    Seus dados vão só para a {nomeEmpresa}, que envia a proposta aos bancos parceiros.
                    A taxa e a parcela finais são definidas pelo banco após a análise de crédito.
                  </p>
                </div>
              )}

              {erro && (
                <p className="mt-4 text-[11px] font-bold text-red-500 bg-red-50 rounded-xl px-3 py-2">{erro}</p>
              )}

              {/* ── Navegação ── */}
              <div className="flex gap-2 mt-6">
                {passo > 1 && (
                  <button
                    type="button" onClick={() => { setErro(null); setPasso(passo - 1); }}
                    className="flex items-center justify-center gap-1 px-4 py-4 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-widest text-[11px] transition"
                  >
                    <ChevronLeft size={15} /> Voltar
                  </button>
                )}
                {passo < 3 ? (
                  <button
                    type="button"
                    disabled={passo === 1 ? !passo1Ok : !passo2Ok}
                    onClick={() => setPasso(passo + 1)}
                    className="flex-1 flex items-center justify-center gap-2 bg-[var(--brand)] text-[var(--brand-fg)] py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continuar <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    type="button" disabled={enviando} onClick={enviar}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition active:scale-[0.98] disabled:opacity-60"
                  >
                    {enviando ? <><Loader2 size={16} className="animate-spin" /> Enviando…</> : <><Check size={16} /> Enviar proposta</>}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-[var(--brand)]";

function Campo({ label, obrigatorio, children }: { label: string; obrigatorio?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">
        {label}{obrigatorio && <span className="text-red-400"> *</span>}
      </label>
      {children}
    </div>
  );
}
