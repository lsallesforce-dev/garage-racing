"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, FileText, Trash2, ExternalLink, Loader2, Search, X, ChevronDown } from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PagamentoItem {
  tipo: "dinheiro" | "pix" | "transferencia" | "financiamento" | "troca";
  valor: number;
  descricao?: string;
  troca_marca?: string;
  troca_modelo?: string;
  troca_ano_fab?: string;
  troca_ano_mod?: string;
  troca_placa?: string;
  troca_renavam?: string;
}

interface DadosContrato {
  vendedor: { nome: string; cnpj: string; endereco: string; cidade: string; estado: string; logo_url?: string };
  comprador: { nome: string; cpf: string; email: string; endereco: string; cidade: string; estado: string; cep: string; telefone: string; apelido?: string };
  veiculo: { marca: string; modelo: string; versao?: string; ano_fab: string; ano_mod: string; placa: string; renavam: string; chassi: string };
  regularidade: { furto: string; multas: string; alienacao: string; outros: string };
  valor_total: number;
  pagamentos: PagamentoItem[];
  observacoes: string;
  cidade_contrato: string;
  data_assinatura: string;
  hora_assinatura: string;
}

interface Contrato {
  id: string;
  status: string;
  created_at: string;
  dados: DadosContrato;
  veiculo_id: string | null;
  cliente_id: string | null;
}

interface ClienteOpt { id: string; nome: string; cpf: string; telefone: string; email: string; endereco: string; cidade: string; estado: string; cep: string; }
interface VeiculoOpt { id: string; marca: string; modelo: string; versao?: string; ano_modelo: string; placa?: string; renavam?: string; chassi?: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function hoje() { return new Date().toISOString().slice(0, 10); }
function horaAgora() { return new Date().toTimeString().slice(0, 5); }

const TIPOS_PAG = [
  { value: "dinheiro",      label: "Dinheiro" },
  { value: "pix",           label: "PIX" },
  { value: "transferencia", label: "Transferência" },
  { value: "financiamento", label: "Financiamento" },
  { value: "troca",         label: "Troca de Veículo" },
];

// ─── Formulário novo contrato ─────────────────────────────────────────────────

function NovoContratoForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);

  // Dados base
  const [clientes, setClientes]   = useState<ClienteOpt[]>([]);
  const [veiculos, setVeiculos]   = useState<VeiculoOpt[]>([]);
  const [vendedor, setVendedor]   = useState<DadosContrato["vendedor"] | null>(null);

  const [buscaCliente, setBuscaCliente] = useState("");
  const [buscaVeiculo, setBuscaVeiculo] = useState("");

  const [clienteSel, setClienteSel] = useState<ClienteOpt | null>(null);
  const [veiculoSel, setVeiculoSel] = useState<VeiculoOpt | null>(null);

  // Dados do contrato (editáveis)
  const [dados, setDados] = useState<DadosContrato>({
    vendedor: { nome: "", cnpj: "", endereco: "", cidade: "", estado: "", logo_url: "" },
    comprador: { nome: "", cpf: "", email: "", endereco: "", cidade: "", estado: "", cep: "", telefone: "", apelido: "" },
    veiculo: { marca: "", modelo: "", versao: "", ano_fab: "", ano_mod: "", placa: "", renavam: "", chassi: "" },
    regularidade: { furto: "NADA CONSTA", multas: "NADA CONSTA", alienacao: "NADA CONSTA", outros: "NADA CONSTA" },
    valor_total: 0,
    pagamentos: [{ tipo: "dinheiro", valor: 0, descricao: "" }],
    observacoes: "",
    cidade_contrato: "",
    data_assinatura: hoje(),
    hora_assinatura: horaAgora(),
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/clientes").then(r => r.json()),
      fetch("/api/financeiro/resumo").then(r => r.json()),
      fetch("/api/contratos/dados-vendedor").then(r => r.json()),
    ]).then(([cli, fin, vend]) => {
      setClientes(cli ?? []);
      setVeiculos((fin.veiculos ?? []).filter((v: { status_venda: string }) => v.status_venda !== "VENDIDO"));
      if (vend) {
        setVendedor(vend);
        setDados(d => ({
          ...d,
          vendedor: { nome: vend.nome_empresa ?? "", cnpj: vend.cnpj ?? "", endereco: vend.endereco ?? "", cidade: vend.cidade ?? "", estado: vend.estado ?? "", logo_url: vend.logo_url ?? "" },
          cidade_contrato: vend.cidade ?? "",
        }));
      }
    });
  }, []);

  function selecionarCliente(c: ClienteOpt) {
    setClienteSel(c);
    setBuscaCliente("");
    setDados(d => ({
      ...d,
      comprador: { nome: c.nome, cpf: c.cpf ?? "", email: c.email ?? "", endereco: c.endereco ?? "", cidade: c.cidade ?? "", estado: c.estado ?? "", cep: c.cep ?? "", telefone: c.telefone ?? "", apelido: "" },
    }));
  }

  function selecionarVeiculo(v: VeiculoOpt) {
    setVeiculoSel(v);
    setBuscaVeiculo("");
    setDados(d => ({
      ...d,
      veiculo: { marca: v.marca, modelo: v.modelo, versao: v.versao ?? "", ano_fab: v.ano_modelo ?? "", ano_mod: v.ano_modelo ?? "", placa: v.placa ?? "", renavam: v.renavam ?? "", chassi: v.chassi ?? "" },
    }));
  }

  function setPag(idx: number, patch: Partial<PagamentoItem>) {
    setDados(d => {
      const p = [...d.pagamentos];
      p[idx] = { ...p[idx], ...patch };
      return { ...d, pagamentos: p };
    });
  }

  function addPag() {
    setDados(d => ({ ...d, pagamentos: [...d.pagamentos, { tipo: "dinheiro", valor: 0, descricao: "" }] }));
  }

  function removePag(idx: number) {
    setDados(d => ({ ...d, pagamentos: d.pagamentos.filter((_, i) => i !== idx) }));
  }

  async function salvar() {
    setSaving(true);
    const res = await fetch("/api/contratos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ veiculo_id: veiculoSel?.id ?? null, cliente_id: clienteSel?.id ?? null, dados }),
    });
    if (res.ok) {
      const contrato = await res.json();
      onCreated();
      window.open(`/contratos/${contrato.id}/imprimir`, "_blank");
      onClose();
    }
    setSaving(false);
  }

  const filtradosCliente = clientes.filter(c =>
    `${c.nome} ${c.cpf} ${c.telefone}`.toLowerCase().includes(buscaCliente.toLowerCase())
  );
  const filtradosVeiculo = veiculos.filter(v =>
    `${v.marca} ${v.modelo} ${v.placa ?? ""}`.toLowerCase().includes(buscaVeiculo.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100">
          <div>
            <p className="font-black uppercase italic tracking-tight text-gray-900">Novo Contrato</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              {step === 1 ? "1. Partes" : step === 2 ? "2. Veículo e Pagamento" : "3. Revisão"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {[1, 2, 3].map(s => (
                <div key={s} className={`w-8 h-1 rounded-full transition-colors ${s <= step ? "bg-gray-900" : "bg-gray-200"}`} />
              ))}
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl"><X size={15} className="text-gray-400" /></button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-7 space-y-6">

          {/* ── Step 1: Partes ── */}
          {step === 1 && (
            <>
              {/* Vendedor */}
              <section>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">Vendedor (sua empresa)</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome / Razão Social" value={dados.vendedor.nome} onChange={v => setDados(d => ({ ...d, vendedor: { ...d.vendedor, nome: v } }))} />
                  <Field label="CNPJ" value={dados.vendedor.cnpj} onChange={v => setDados(d => ({ ...d, vendedor: { ...d.vendedor, cnpj: v } }))} placeholder="00.000.000/0001-00" />
                  <Field label="Endereço completo" value={dados.vendedor.endereco} onChange={v => setDados(d => ({ ...d, vendedor: { ...d.vendedor, endereco: v } }))} className="col-span-2" />
                  <Field label="Cidade" value={dados.vendedor.cidade} onChange={v => setDados(d => ({ ...d, vendedor: { ...d.vendedor, cidade: v } }))} />
                  <Field label="Estado (ex: SP)" value={dados.vendedor.estado} onChange={v => setDados(d => ({ ...d, vendedor: { ...d.vendedor, estado: v } }))} />
                </div>
              </section>

              {/* Comprador */}
              <section>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">Comprador</p>

                {/* Busca cliente */}
                {!clienteSel ? (
                  <div className="relative mb-3">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)}
                      placeholder="Buscar cliente cadastrado..."
                      className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400" />
                    {buscaCliente && filtradosCliente.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                        {filtradosCliente.slice(0, 8).map(c => (
                          <button key={c.id} onClick={() => selecionarCliente(c)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                            <p className="text-sm font-bold text-gray-900">{c.nome}</p>
                            <p className="text-[10px] text-gray-400">{c.cpf} · {c.telefone}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-2xl px-4 py-3 mb-3">
                    <div>
                      <p className="font-black text-sm text-gray-900">{clienteSel.nome}</p>
                      <p className="text-[10px] text-gray-500">{clienteSel.cpf} · {clienteSel.telefone}</p>
                    </div>
                    <button onClick={() => setClienteSel(null)} className="p-1.5 hover:bg-red-50 rounded-xl"><X size={13} className="text-red-400" /></button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome completo" value={dados.comprador.nome} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, nome: v } }))} className="col-span-2" />
                  <Field label="CPF / CNPJ" value={dados.comprador.cpf} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, cpf: v } }))} />
                  <Field label="Email" value={dados.comprador.email} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, email: v } }))} />
                  <Field label="Endereço" value={dados.comprador.endereco} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, endereco: v } }))} className="col-span-2" />
                  <Field label="Cidade" value={dados.comprador.cidade} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, cidade: v } }))} />
                  <Field label="Estado" value={dados.comprador.estado} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, estado: v } }))} />
                  <Field label="CEP" value={dados.comprador.cep} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, cep: v } }))} />
                  <Field label="Telefone" value={dados.comprador.telefone} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, telefone: v } }))} />
                  <Field label="Apelido (opcional, ex: LUCIA)" value={dados.comprador.apelido ?? ""} onChange={v => setDados(d => ({ ...d, comprador: { ...d.comprador, apelido: v } }))} />
                </div>
              </section>
            </>
          )}

          {/* ── Step 2: Veículo + Pagamento ── */}
          {step === 2 && (
            <>
              <section>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">Veículo</p>

                {!veiculoSel ? (
                  <div className="relative mb-3">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={buscaVeiculo} onChange={e => setBuscaVeiculo(e.target.value)}
                      placeholder="Buscar veículo do estoque..."
                      className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400" />
                    {buscaVeiculo && filtradosVeiculo.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                        {filtradosVeiculo.slice(0, 8).map(v => (
                          <button key={v.id} onClick={() => selecionarVeiculo(v)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                            <p className="text-sm font-bold text-gray-900">{v.marca} {v.modelo}</p>
                            <p className="text-[10px] text-gray-400">{v.placa ?? "sem placa"} · {v.ano_modelo}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-2xl px-4 py-3 mb-3">
                    <div>
                      <p className="font-black text-sm text-gray-900">{veiculoSel.marca} {veiculoSel.modelo}</p>
                      <p className="text-[10px] text-gray-500">{veiculoSel.placa} · {veiculoSel.ano_modelo}</p>
                    </div>
                    <button onClick={() => setVeiculoSel(null)} className="p-1.5 hover:bg-red-50 rounded-xl"><X size={13} className="text-red-400" /></button>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Marca" value={dados.veiculo.marca} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, marca: v } }))} />
                  <Field label="Modelo" value={dados.veiculo.modelo} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, modelo: v } }))} />
                  <Field label="Versão" value={dados.veiculo.versao ?? ""} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, versao: v } }))} />
                  <Field label="Ano Fabricação" value={dados.veiculo.ano_fab} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, ano_fab: v } }))} />
                  <Field label="Ano Modelo" value={dados.veiculo.ano_mod} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, ano_mod: v } }))} />
                  <Field label="Placa" value={dados.veiculo.placa} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, placa: v } }))} />
                  <Field label="RENAVAM" value={dados.veiculo.renavam} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, renavam: v } }))} />
                  <Field label="CHASSI" value={dados.veiculo.chassi} onChange={v => setDados(d => ({ ...d, veiculo: { ...d.veiculo, chassi: v } }))} className="col-span-2" />
                </div>

                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-4 mb-3">Situação de Regularidade</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["furto", "multas", "alienacao", "outros"] as const).map(k => (
                    <Field key={k}
                      label={k === "furto" ? "Furto" : k === "multas" ? "Multas e Taxas" : k === "alienacao" ? "Alienação Fiduciária" : "Outros registros"}
                      value={dados.regularidade[k]}
                      onChange={v => setDados(d => ({ ...d, regularidade: { ...d.regularidade, [k]: v } }))} />
                  ))}
                </div>
              </section>

              <section>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">Preço e Forma de Pagamento</p>
                <Field label="Valor total (R$)" value={String(dados.valor_total || "")} type="number"
                  onChange={v => setDados(d => ({ ...d, valor_total: parseFloat(v) || 0 }))} className="mb-3" />

                {dados.pagamentos.map((p, i) => (
                  <div key={i} className="border border-gray-100 rounded-2xl p-4 mb-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Forma {i + 1}</p>
                      {dados.pagamentos.length > 1 && (
                        <button onClick={() => removePag(i)} className="p-1 hover:bg-red-50 rounded-lg"><Trash2 size={12} className="text-red-400" /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Tipo</label>
                        <select value={p.tipo} onChange={e => setPag(i, { tipo: e.target.value as PagamentoItem["tipo"] })}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400">
                          {TIPOS_PAG.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <Field label="Valor (R$)" value={String(p.valor || "")} type="number" onChange={v => setPag(i, { valor: parseFloat(v) || 0 })} />
                    </div>
                    {p.tipo !== "troca" && (
                      <Field label="Descrição (opcional)" value={p.descricao ?? ""} onChange={v => setPag(i, { descricao: v })} />
                    )}
                    {p.tipo === "troca" && (
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Marca" value={p.troca_marca ?? ""} onChange={v => setPag(i, { troca_marca: v })} />
                        <Field label="Modelo" value={p.troca_modelo ?? ""} onChange={v => setPag(i, { troca_modelo: v })} />
                        <Field label="Ano Fab." value={p.troca_ano_fab ?? ""} onChange={v => setPag(i, { troca_ano_fab: v })} />
                        <Field label="Ano Mod." value={p.troca_ano_mod ?? ""} onChange={v => setPag(i, { troca_ano_mod: v })} />
                        <Field label="Placa" value={p.troca_placa ?? ""} onChange={v => setPag(i, { troca_placa: v })} />
                        <Field label="RENAVAM" value={p.troca_renavam ?? ""} onChange={v => setPag(i, { troca_renavam: v })} />
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={addPag}
                  className="w-full py-2.5 border border-dashed border-gray-200 rounded-2xl text-[9px] font-black uppercase tracking-widest text-gray-400 hover:border-gray-400 hover:text-gray-700 transition-colors flex items-center justify-center gap-2">
                  <Plus size={12} /> Adicionar forma de pagamento
                </button>

                <Field label="Observações (opcional)" value={dados.observacoes}
                  onChange={v => setDados(d => ({ ...d, observacoes: v }))} className="mt-3" />
              </section>
            </>
          )}

          {/* ── Step 3: Revisão ── */}
          {step === 3 && (
            <section className="space-y-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Data e Local de Assinatura</p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Cidade" value={dados.cidade_contrato} onChange={v => setDados(d => ({ ...d, cidade_contrato: v }))} />
                <Field label="Data" value={dados.data_assinatura} type="date" onChange={v => setDados(d => ({ ...d, data_assinatura: v }))} />
                <Field label="Hora" value={dados.hora_assinatura} type="time" onChange={v => setDados(d => ({ ...d, hora_assinatura: v }))} />
              </div>

              <div className="bg-gray-50 rounded-2xl p-4 space-y-2 text-sm">
                <Row label="Vendedor" value={dados.vendedor.nome} />
                <Row label="CNPJ" value={dados.vendedor.cnpj} />
                <Row label="Comprador" value={dados.comprador.nome} />
                <Row label="CPF" value={dados.comprador.cpf} />
                <Row label="Veículo" value={`${dados.veiculo.marca} ${dados.veiculo.modelo} ${dados.veiculo.ano_mod}`} />
                <Row label="Placa" value={dados.veiculo.placa} />
                <Row label="RENAVAM" value={dados.veiculo.renavam} />
                <Row label="CHASSI" value={dados.veiculo.chassi} />
                <Row label="Valor total" value={fmt(dados.valor_total)} highlight />
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-5 border-t border-gray-100 flex justify-between">
          {step > 1
            ? <button onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)} className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-colors">Voltar</button>
            : <div />
          }
          {step < 3
            ? <button onClick={() => setStep(s => (s + 1) as 2 | 3)}
                className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors">
                Próximo →
              </button>
            : <button onClick={salvar} disabled={saving}
                className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-green-600 transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                Gerar Contrato
              </button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = "text", className = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400" />
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
      <span className={`text-sm font-bold ${highlight ? "text-green-600" : "text-gray-900"}`}>{value || "—"}</span>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ContratosPage() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading]     = useState(true);
  const [novoOpen, setNovoOpen]   = useState(false);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/contratos");
    if (res.ok) setContratos(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function excluir(id: string) {
    if (!confirm("Excluir este contrato?")) return;
    await fetch(`/api/contratos/${id}`, { method: "DELETE" });
    setContratos(c => c.filter(x => x.id !== id));
  }

  return (
    <div className="p-6 md:p-10 bg-[#f4f4f2] min-h-screen font-sans">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/0 text-[9px]">·</p>
            <h1 className="text-2xl font-black italic uppercase tracking-tighter text-gray-900">Contratos</h1>
            <p className="text-xs text-gray-400 font-bold mt-1">{contratos.length} contrato{contratos.length !== 1 ? "s" : ""} emitido{contratos.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={() => setNovoOpen(true)}
            className="flex items-center gap-2 px-5 py-3 bg-gray-900 hover:bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors">
            <Plus size={14} /> Novo Contrato
          </button>
        </div>

        {/* Lista */}
        <div className="bg-white rounded-[2rem] border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
          ) : contratos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-300">
              <FileText size={36} className="mb-3" />
              <p className="text-sm font-bold">Nenhum contrato emitido ainda</p>
              <p className="text-xs mt-1">Clique em "Novo Contrato" para começar</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              <div className="hidden md:grid grid-cols-[1fr_1fr_120px_100px_80px] items-center px-6 py-2 bg-gray-50">
                {["Comprador", "Veículo", "Valor", "Data", ""].map(h => (
                  <p key={h} className="text-[8px] font-black uppercase tracking-widest text-gray-400">{h}</p>
                ))}
              </div>
              {contratos.map(c => {
                const d = c.dados;
                const veiculo = `${d.veiculo?.marca ?? ""} ${d.veiculo?.modelo ?? ""}`.trim();
                const data = new Date(c.created_at).toLocaleDateString("pt-BR");
                return (
                  <div key={c.id} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_1fr_120px_100px_80px] items-center px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="font-bold text-sm text-gray-900">{d.comprador?.nome || "—"}</p>
                      <p className="text-[10px] text-gray-400">{d.comprador?.cpf}</p>
                    </div>
                    <div className="hidden md:block">
                      <p className="text-sm font-bold text-gray-700">{veiculo || "—"}</p>
                      <p className="text-[10px] text-gray-400">{d.veiculo?.placa}</p>
                    </div>
                    <p className="hidden md:block text-sm font-black text-gray-900">
                      {d.valor_total ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(d.valor_total) : "—"}
                    </p>
                    <p className="hidden md:block text-[10px] text-gray-400 font-bold">{data}</p>
                    <div className="flex items-center gap-1 justify-end">
                      <Link href={`/contratos/${c.id}/imprimir`} target="_blank"
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors" title="Abrir / Imprimir">
                        <ExternalLink size={14} className="text-gray-400" />
                      </Link>
                      <button onClick={() => excluir(c.id)} className="p-2 hover:bg-red-50 rounded-xl transition-colors" title="Excluir">
                        <Trash2 size={14} className="text-red-400" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {novoOpen && (
        <NovoContratoForm onClose={() => setNovoOpen(false)} onCreated={carregar} />
      )}
    </div>
  );
}
