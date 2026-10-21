"use client";

// Simulação de financiamento manual: o vendedor consulta os bancos da loja
// (acesso cadastrado em Configurações › Financiamento) sem depender da IA.
// O mesmo histórico mostra as simulações que a IA fez no WhatsApp.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Landmark, Loader2, CheckCircle2, XCircle, Clock, Copy, Bot, User, AlertTriangle, Coins, RotateCcw, Trash2 } from "lucide-react";
import { ofertasAprovadas, valorDigitado, type Oferta } from "@/lib/financiamento-parcelas";
import { cpfValido } from "@/lib/cpf";

type Veiculo = { id: string; marca: string | null; modelo: string | null; ano: number | null; ano_modelo: number | null; placa: string | null; preco_sugerido: number | string | null };
type ResultadoBanco = { banco: string; status: string | null; dados?: { parcelas?: string | null; valor_entrada?: string | null; valor_solicitado?: string | null; mensagem_recusa?: string | null } | null };
type SimResumo = {
  id: string; origem: string | null; cliente_nome: string | null; veiculo_desc: string | null; cpf: string | null;
  valor_veiculo: number | null; entrada: number | null; status: string; melhores: Oferta[] | null; created_at: string;
  algum_respondeu?: boolean;
  cpf_invalido?: boolean;
};
type SimDetalhe = SimResumo & {
  erro: string | null; resultado: { resultados?: ResultadoBanco[] } | null; custo_brl: number | null; sandbox: boolean; bancos: string[];
  veiculo_id: string | null; celular: string | null; nascimento: string | null;
  retornos?: Record<string, number | null>;
};

const brl = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_BANCO: Record<string, { txt: string; cor: string }> = {
  aprovado: { txt: "Aprovado", cor: "text-green-700 bg-green-100" },
  simulacao: { txt: "Só simulação", cor: "text-blue-700 bg-blue-100" },
  recusado: { txt: "Recusado", cor: "text-red-700 bg-red-100" },
  credencial_invalida: { txt: "Senha incorreta", cor: "text-amber-700 bg-amber-100" },
  credencial_restricao: { txt: "Acesso restrito", cor: "text-amber-700 bg-amber-100" },
  erro: { txt: "Erro no banco", cor: "text-gray-600 bg-gray-100" },
  manutencao: { txt: "Em manutenção", cor: "text-gray-600 bg-gray-100" },
  indisponivel: { txt: "Fora do horário", cor: "text-gray-600 bg-gray-100" },
};

const FALHA = new Set<string | null>([null, "erro", "manutencao", "indisponivel"]);

const vazio = { nome: "", cpf: "", nascimento: "", celular: "", veiculoId: "", placa: "", marca: "", modelo: "", ano: "", valorVeiculo: "", entrada: "" };

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function mascaraCel(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.length <= 2 ? d : d.length <= 7 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export default function FinanciamentoPage() {
  const [carregando, setCarregando] = useState(true);
  const [servico, setServico] = useState(true);
  const [bancosAtivos, setBancosAtivos] = useState<string[]>([]);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [historico, setHistorico] = useState<SimResumo[]>([]);
  const [f, setF] = useState(vazio);
  const [consentimento, setConsentimento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [atual, setAtual] = useState<SimDetalhe | null>(null);
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/financiamento/simulacoes", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setCarregando(false);
    if (!r.ok) { setErro(j.error ?? "Não foi possível carregar"); return; }
    setServico(j.servico);
    setBancosAtivos(j.bancos);
    setEscolhidos((e) => (e.length ? e : j.bancos));
    setVeiculos(j.veiculos);
    setHistorico(j.simulacoes);
  }, []);

  useEffect(() => { carregar(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [carregar]);

  const abrir = useCallback(async (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    const r = await fetch(`/api/financiamento/simulacoes/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const s: SimDetalhe = await r.json();
    setAtual(s);
    if (s.status === "pendente" || s.status === "processando") {
      timer.current = setTimeout(() => abrir(id), 3000);
    } else {
      carregar();
    }
  }, [carregar]);

  const set = (k: keyof typeof vazio) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === "cpf" ? mascaraCpf(e.target.value) : k === "celular" ? mascaraCel(e.target.value) : e.target.value });

  const veiculoSel = veiculos.find((v) => v.id === f.veiculoId);
  const outro = f.veiculoId === "outro";

  async function simular(e: React.FormEvent) {
    e.preventDefault();
    if (cpfRuim) {
      setErro("CPF inválido: algum número está trocado. Confira com o documento do cliente antes de simular — com CPF errado todos os bancos dão erro.");
      return;
    }
    setErro(""); setEnviando(true); setCopiado(false);
    const r = await fetch("/api/financiamento/simular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: f.nome, cpf: f.cpf, nascimento: f.nascimento, celular: f.celular, entrada: f.entrada,
        ...(outro
          ? { placa: f.placa, marca: f.marca, modelo: f.modelo, ano: f.ano, valorVeiculo: f.valorVeiculo }
          : { veiculoId: f.veiculoId }),
        bancos: escolhidos, consentimento,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) { setErro(j.error ?? "Não foi possível simular"); return; }
    abrir(j.id);
    carregar();
  }

  // Reenviar = carregar os dados desta simulação no formulário (cliente,
  // carro, entrada, bancos) pra conferir, trocar o que precisar e simular.
  // Bancos: se só uma parte deu erro, já vêm marcados só os que falharam
  // (os que responderam foram cobrados).
  function reenviar(s: SimDetalhe, soFalhas: boolean) {
    const d = (s.celular ?? "").replace(/\D/g, "");
    const noEstoque = !!s.veiculo_id && veiculos.some((v) => v.id === s.veiculo_id);
    const reais = (n: number | null) => (n == null ? "" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
    setF({
      ...vazio,
      nome: s.cliente_nome ?? "",
      cpf: mascaraCpf(s.cpf ?? ""),
      nascimento: s.nascimento ?? "",
      celular: mascaraCel(d),
      // Carro vendido/fora do estoque ou digitado à mão: escolhe de novo.
      veiculoId: noEstoque ? s.veiculo_id! : "",
      entrada: reais(s.entrada),
    });
    const res = s.resultado?.resultados ?? [];
    const falharam = res.filter((r) => FALHA.has(r.status as any)).map((r) => r.banco);
    const base = soFalhas && falharam.length ? falharam : (s.bancos ?? []);
    const marcados = base.filter((b) => bancosAtivos.includes(b));
    setEscolhidos(marcados.length ? marcados : bancosAtivos);
    // Mesmo cliente que já autorizou; se trocar o CPF, desmarque.
    setConsentimento(true);
    setErro(noEstoque ? "" : "Escolha o veículo de novo.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function apagar(s: SimResumo) {
    if (!confirm(`Apagar a simulação de ${s.cliente_nome || s.cpf || "cliente"} (${s.veiculo_desc ?? "veículo"})?`)) return;
    const r = await fetch(`/api/financiamento/simulacoes/${s.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Não foi possível apagar"); return; }
    if (atual?.id === s.id) { if (timer.current) clearTimeout(timer.current); setAtual(null); }
    setHistorico((h) => h.filter((x) => x.id !== s.id));
  }

  // Botão de cada linha do histórico: busca o detalhe e joga no formulário.
  async function carregarNoFormulario(id: string) {
    const r = await fetch(`/api/financiamento/simulacoes/${id}`, { cache: "no-store" });
    if (!r.ok) { setErro("Não foi possível carregar essa simulação"); return; }
    const s: SimDetalhe = await r.json();
    setAtual(s);
    reenviar(s, false);
  }

  function copiarParaCliente() {
    if (!atual?.melhores?.length) return;
    const linhas = atual.melhores.map((o) =>
      `🏦 *${o.banco}* — ${o.prazo}x de ${brl(o.parcela)}${o.entrada != null ? ` (entrada ${brl(o.entrada)})` : ""}`);
    const texto =
      `Consultei os bancos${atual.veiculo_desc ? ` pro ${atual.veiculo_desc}` : ""} e saíram estas condições:\n\n${linhas.join("\n")}\n\n` +
      `São condições pré-aprovadas, sujeitas à análise final do banco.`;
    navigator.clipboard.writeText(texto).then(() => setCopiado(true)).catch(() => {});
  }

  const rodando = atual && (atual.status === "pendente" || atual.status === "processando");
  const resultados = atual?.resultado?.resultados ?? [];
  const falhas = resultados.filter((r) => FALHA.has(r.status as any)).length;
  const podeReenviar = !!atual && !rodando;
  // Todos os prazos e o retorno estimado (financiado × % cadastrado pela loja) por banco aprovado.
  const aprovadas = ofertasAprovadas(resultados, atual?.retornos ?? {});
  const porBanco = new Map(aprovadas.map((o) => [o.banco, o]));
  const maiorRetorno = aprovadas.reduce<Oferta | null>((m, o) => (o.retorno != null && (!m || o.retorno > (m.retorno ?? 0)) ? o : m), null);
  const pode = servico && bancosAtivos.length > 0;
  const cpfRuim = f.cpf.replace(/\D/g, "").length === 11 && !cpfValido(f.cpf);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-gray-900 flex items-center gap-3">
          <Landmark className="text-red-500" size={32} />
          Financiamento
        </h1>
        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">
          Simule em todos os seus bancos de uma vez
        </p>
      </div>

      {!carregando && !pode && (
        <div className="flex items-center gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-6">
          <AlertTriangle size={16} />
          {!servico
            ? "Serviço de simulação ainda não ativado no AutoZap."
            : <>Cadastre o acesso de pelo menos um banco em <Link href="/configuracoes?tab=financiamento" className="font-black underline">Configurações › Financiamento</Link>.</>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* ── Formulário ── */}
        <form onSubmit={simular} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 md:p-8 flex flex-col gap-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Nova simulação</h2>

          <Campo label="Nome do cliente (opcional)">
            <input className={inp} value={f.nome} onChange={set("nome")} placeholder="Nome" />
          </Campo>
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo label="CPF">
              <input className={`${inp} ${cpfRuim ? "border-red-400" : ""}`} value={f.cpf} onChange={set("cpf")} placeholder="000.000.000-00" inputMode="numeric" required />
              {cpfRuim && (
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                  <AlertTriangle size={13} /> CPF inválido: algum número está trocado. Confira com o documento do cliente.
                </span>
              )}
            </Campo>
            <Campo label="Data de nascimento">
              <input className={inp} type="date" value={f.nascimento} onChange={set("nascimento")} required />
            </Campo>
          </div>
          <Campo label="Celular do cliente">
            <input className={inp} value={f.celular} onChange={set("celular")} placeholder="(17) 99999-9999" inputMode="tel" required />
          </Campo>

          <Campo label="Veículo">
            <select className={inp} value={f.veiculoId} onChange={set("veiculoId")} required>
              <option value="">Escolha do estoque…</option>
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.marca, v.modelo, v.ano_modelo ?? v.ano].filter(Boolean).join(" ")}{v.placa ? ` · ${v.placa}` : ""} — {brl(v.preco_sugerido)}
                </option>
              ))}
              <option value="outro">Outro veículo (digitar)</option>
            </select>
          </Campo>
          {veiculoSel && !veiculoSel.placa && (
            <p className="text-[10px] text-amber-700 -mt-2">Carro sem placa no cadastro: alguns bancos podem não localizar a versão.</p>
          )}
          {outro && (
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Placa"><input className={inp} value={f.placa} onChange={set("placa")} placeholder="ABC1D23" /></Campo>
              <Campo label="Valor do veículo"><input className={inp} value={f.valorVeiculo} onChange={set("valorVeiculo")} placeholder="85.000" inputMode="decimal" required /><Entendido valor={f.valorVeiculo} /></Campo>
              <Campo label="Marca (sem placa)"><input className={inp} value={f.marca} onChange={set("marca")} placeholder="Chevrolet" /></Campo>
              <Campo label="Modelo (sem placa)"><input className={inp} value={f.modelo} onChange={set("modelo")} placeholder="Onix LT 1.0" /></Campo>
              <Campo label="Ano modelo (sem placa)"><input className={inp} value={f.ano} onChange={set("ano")} placeholder="2022" inputMode="numeric" /></Campo>
            </div>
          )}

          <Campo label="Entrada (deixe vazio se não souber)">
            <input className={inp} value={f.entrada} onChange={set("entrada")} placeholder="10.000 ou 0" inputMode="decimal" />
            <Entendido valor={f.entrada} />
          </Campo>

          {bancosAtivos.length > 0 && (
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bancos</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {bancosAtivos.map((b) => {
                  const on = escolhidos.includes(b);
                  return (
                    <button type="button" key={b}
                      onClick={() => setEscolhidos(on ? escolhidos.filter((x) => x !== b) : [...escolhidos, b])}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-colors ${on ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-400 border-gray-200"}`}>
                      {b}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 text-[11px] text-gray-600">
            <input type="checkbox" className="mt-0.5 accent-red-500" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} />
            O cliente autorizou a consulta do CPF dele nos bancos.
          </label>

          {erro && <p className="text-[11px] text-red-600">{erro}</p>}
          <button
            type="submit"
            disabled={!pode || enviando || !consentimento || !escolhidos.length || !!rodando}
            className="bg-gray-900 text-white rounded-xl py-3 text-[11px] font-black uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />}
            {escolhidos.length ? `Simular em ${escolhidos.length} ${escolhidos.length === 1 ? "banco" : "bancos"}` : "Simular"}
          </button>
        </form>

        {/* ── Resultado ── */}
        <div className="flex flex-col gap-6">
          {atual && (
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 md:p-8">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Resultado</h2>
                {rodando && <span className="flex items-center gap-1 text-[10px] text-blue-700"><Loader2 size={12} className="animate-spin" /> consultando os bancos…</span>}
                {atual.status === "falhou" && <span className="text-[10px] text-red-600">falhou: {atual.erro}</span>}
                {atual.sandbox && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">teste</span>}
              </div>
              {podeReenviar && (
                <div className="flex flex-wrap gap-2 mb-3">
                  <button onClick={() => reenviar(atual, false)}
                    className="flex items-center gap-1.5 bg-gray-900 text-white rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider">
                    <RotateCcw size={12} /> Reenviar / editar
                  </button>
                  {falhas > 0 && falhas < resultados.length && (
                    <button onClick={() => reenviar(atual, true)}
                      className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider">
                      <RotateCcw size={12} /> Só os {falhas} com erro
                    </button>
                  )}
                </div>
              )}
              {atual.cpf && !cpfValido(atual.cpf) && (
                <div className="flex items-start gap-2 text-[12px] text-red-800 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span><b>CPF inválido nesta simulação.</b> Algum número foi digitado trocado — por isso os bancos deram erro. Peça o CPF de novo ao cliente e use “Reenviar / editar”.</span>
                </div>
              )}
              <p className="text-[12px] text-gray-700 mb-4">
                {atual.cliente_nome ? <b>{atual.cliente_nome} · </b> : null}
                {atual.veiculo_desc ?? "Veículo"} · {brl(atual.valor_veiculo)} · entrada {atual.entrada == null ? "não informada" : brl(atual.entrada)}
              </p>

              {!!atual.melhores?.length && (
                <div className="bg-green-50 rounded-2xl p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-green-800">Melhores condições</span>
                    <button onClick={copiarParaCliente} className="flex items-center gap-1 text-[10px] font-black uppercase text-green-800 hover:text-green-950">
                      <Copy size={12} /> {copiado ? "Copiado!" : "Copiar pro cliente"}
                    </button>
                  </div>
                  {atual.melhores.map((o) => {
                    const ret = porBanco.get(o.banco)?.retorno;
                    return (
                      <p key={o.banco} className="text-[13px] text-green-900">
                        <b>{o.banco}</b> — {o.prazo}x de {brl(o.parcela)}{o.entrada != null ? ` · entrada ${brl(o.entrada)}` : ""}
                        {ret != null && <span className="text-[11px] text-amber-700"> · retorno ~{brl(ret)}</span>}
                      </p>
                    );
                  })}
                  <p className="text-[10px] text-green-800/70 mt-2">Menor parcela primeiro. O retorno não vai no texto do cliente.</p>
                </div>
              )}

              <div className="flex flex-col divide-y divide-gray-100">
                {(resultados.length ? resultados : (atual.bancos ?? []).map((b) => ({ banco: b, status: null }) as ResultadoBanco)).map((r) => {
                  const st = r.status ? STATUS_BANCO[r.status] ?? { txt: r.status, cor: "text-gray-600 bg-gray-100" } : null;
                  const o = porBanco.get(r.banco);
                  return (
                    <div key={r.banco} className="py-2.5 flex items-start gap-3 flex-wrap">
                      <span className="text-[12px] font-black text-gray-800 min-w-[100px]">{r.banco}</span>
                      {st
                        ? <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${st.cor}`}>{st.txt}</span>
                        : atual.status === "falhou" || atual.status === "concluida"
                          ? <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full text-gray-600 bg-gray-100">{atual.status === "falhou" ? "não enviado" : "sem resposta"}</span>
                          : <span className="flex items-center gap-1 text-[10px] text-gray-400"><Clock size={11} /> aguardando</span>}
                      {o ? (
                        <span className="text-[11px] text-gray-600 flex-1 min-w-[160px]">
                          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {o.opcoes.map((x) => (
                              <span key={x.prazo} className={x.prazo === o.prazo ? "font-bold text-gray-900" : ""}>{x.prazo}x {brl(x.parcela)}</span>
                            ))}
                          </span>
                          <span className="block text-[10px] text-gray-400 mt-0.5">
                            {o.entrada != null ? `entrada ${brl(o.entrada)}` : ""}{o.financiado != null ? ` · financiado ${brl(o.financiado)}` : ""}
                          </span>
                          {o.retorno != null ? (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 mt-0.5">
                              <Coins size={12} /> retorno estimado {brl(o.retorno)} ({o.retornoPct}%)
                              {maiorRetorno?.banco === o.banco && aprovadas.length > 1 && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-100">maior retorno</span>
                              )}
                            </span>
                          ) : (
                            <span className="block text-[10px] text-gray-400 mt-0.5">
                              sem % de retorno — <Link href="/configuracoes?tab=financiamento" className="underline">cadastrar</Link>
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-600 flex-1 min-w-[160px]">
                          {r.dados?.parcelas ?? ""}
                          {r.dados?.valor_entrada ? ` · entrada R$ ${r.dados.valor_entrada}` : ""}
                          {r.dados?.valor_solicitado ? ` · financiado R$ ${r.dados.valor_solicitado}` : ""}
                          {r.status === "erro"
                            ? <span title={r.dados?.mensagem_recusa ?? ""}>falha técnica na consulta deste banco — não foi cobrado</span>
                            : r.dados?.mensagem_recusa ?? ""}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {(resultados.some((r) => r.status === "credencial_invalida" || r.status === "credencial_restricao")) && (
                <p className="text-[10px] text-amber-700 mt-3">
                  Confira o acesso desse banco em <Link href="/configuracoes?tab=financiamento" className="underline font-black">Configurações › Financiamento</Link>.
                </p>
              )}
            </div>
          )}

          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 md:p-8">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-3">Últimas simulações</h2>
            {carregando ? (
              <Loader2 size={16} className="animate-spin text-gray-400" />
            ) : !historico.length ? (
              <p className="text-[11px] text-gray-400">Nenhuma simulação ainda.</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-100">
                {historico.map((s) => {
                  const melhor = s.melhores?.[0];
                  return (
                    <div key={s.id} className={`flex items-center gap-1 rounded-lg -mx-2 ${atual?.id === s.id ? "bg-gray-50" : ""}`}>
                    <button onClick={() => abrir(s.id)}
                      className="flex-1 min-w-0 py-2.5 flex items-center gap-3 text-left hover:bg-gray-50 rounded-lg px-2">
                      {s.origem === "painel" ? <User size={14} className="text-gray-400 shrink-0" /> : <Bot size={14} className="text-red-400 shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12px] font-bold text-gray-800 truncate">{s.cliente_nome || s.cpf || "Cliente"} · {s.veiculo_desc ?? "—"}</span>
                        <span className="block text-[10px] text-gray-400">
                          {new Date(s.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {s.origem === "painel" ? " · painel" : " · IA no WhatsApp"}
                        </span>
                      </span>
                      {s.status === "concluida" ? (
                        melhor
                          ? <span className="flex items-center gap-1 text-[11px] text-green-700 font-bold"><CheckCircle2 size={12} /> {melhor.prazo}x {brl(melhor.parcela)}</span>
                          : s.cpf_invalido
                            ? <span className="flex items-center gap-1 text-[11px] font-bold text-red-700"><AlertTriangle size={12} /> CPF inválido</span>
                          : s.algum_respondeu === false
                            ? <span className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={12} /> erro nos bancos</span>
                            : <span className="flex items-center gap-1 text-[11px] text-red-600"><XCircle size={12} /> sem aprovação</span>
                      ) : s.status === "falhou" ? (
                        <span className="text-[11px] text-red-600">falhou</span>
                      ) : (
                        <Loader2 size={12} className="animate-spin text-blue-500" />
                      )}
                    </button>
                    <button
                      onClick={() => carregarNoFormulario(s.id)}
                      disabled={s.status === "pendente" || s.status === "processando"}
                      title="Recarregar estes dados no formulário"
                      aria-label="Recarregar dados no formulário"
                      className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30">
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => apagar(s)}
                      title="Apagar esta simulação"
                      aria-label="Apagar simulação"
                      className="shrink-0 p-2 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50">
                      <Trash2 size={14} />
                    </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mostra como o valor digitado foi entendido ("57.000,00" → R$ 57.000,00). */
function Entendido({ valor }: { valor: string }) {
  if (!valor.trim()) return null;
  const n = valorDigitado(valor);
  return n == null || Number.isNaN(n)
    ? <span className="text-[10px] text-red-600">Não entendi esse valor — use só números, ex.: 57.000</span>
    : <span className="text-[10px] text-gray-400">= {brl(n)}</span>;
}

const inp = "w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] bg-white";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      {children}
    </label>
  );
}
