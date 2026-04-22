"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X, Plus, Trash2, Check, Loader2, Search, User,
  Phone, Mail, MapPin, FileText, Car, ChevronRight,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface VeiculoCliente {
  id: string;
  marca: string;
  modelo: string;
  ano_modelo: string | null;
  preco_venda_final: number | null;
  data_venda: string | null;
  status_venda: string;
}

interface Cliente {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  observacoes: string | null;
  created_at: string;
  veiculos: VeiculoCliente[];
}

type ClienteForm = Omit<Cliente, "id" | "created_at" | "veiculos">;

const FORM_VAZIO: ClienteForm = {
  nome: "", cpf: "", telefone: "", email: "",
  endereco: "", cidade: "", estado: "", cep: "", observacoes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function iniciais(nome: string) {
  return nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function avatarColor(nome: string) {
  const cores = [
    "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-green-500",
    "bg-teal-500", "bg-blue-500", "bg-indigo-500", "bg-purple-500",
  ];
  let hash = 0;
  for (const c of nome) hash = (hash * 31 + c.charCodeAt(0)) % cores.length;
  return cores[hash];
}

// ─── Campo de formulário ──────────────────────────────────────────────────────

function Campo({ label, value, onChange, placeholder, type = "text", full = false }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">{label}</label>
      <input
        type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-gray-900 font-medium focus:outline-none focus:border-gray-400 bg-white"
      />
    </div>
  );
}

// ─── SlideOver de detalhes / edição ──────────────────────────────────────────

function SlideOver({ cliente, onClose, onSave, onDelete }: {
  cliente: Cliente;
  onClose: () => void;
  onSave: (id: string, fields: Partial<ClienteForm>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [form, setForm] = useState<ClienteForm>({
    nome: cliente.nome, cpf: cliente.cpf ?? "", telefone: cliente.telefone ?? "",
    email: cliente.email ?? "", endereco: cliente.endereco ?? "",
    cidade: cliente.cidade ?? "", estado: cliente.estado ?? "",
    cep: cliente.cep ?? "", observacoes: cliente.observacoes ?? "",
  });

  function set(field: keyof ClienteForm) {
    return (v: string) => setForm((p) => ({ ...p, [field]: v }));
  }

  async function salvar() {
    setSaving(true);
    await onSave(cliente.id, form);
    setSaving(false);
    setEditando(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[500px] bg-white shadow-2xl flex flex-col"
        style={{ animation: "slideInRight 0.25s ease-out" }}>

        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className={`w-12 h-12 rounded-2xl ${avatarColor(cliente.nome)} flex items-center justify-center flex-shrink-0`}>
            <span className="text-white font-black text-lg">{iniciais(cliente.nome)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-gray-900 text-lg tracking-tight truncate">{cliente.nome}</p>
            <p className="text-xs text-gray-400 font-bold">
              Cliente desde {new Date(cliente.created_at).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditando(!editando)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                editando ? "bg-gray-100 text-gray-500" : "bg-gray-900 text-white hover:bg-red-600"
              }`}>
              {editando ? "Cancelar" : "Editar"}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <X size={16} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {editando ? (
            /* ── Formulário de edição ── */
            <div className="grid grid-cols-2 gap-4">
              <Campo label="Nome completo" value={form.nome} onChange={set("nome")} placeholder="João da Silva" full />
              <Campo label="CPF" value={form.cpf} onChange={set("cpf")} placeholder="000.000.000-00" />
              <Campo label="Telefone" value={form.telefone} onChange={set("telefone")} placeholder="(11) 99999-9999" />
              <Campo label="E-mail" value={form.email} onChange={set("email")} placeholder="joao@email.com" full />
              <Campo label="Endereço" value={form.endereco} onChange={set("endereco")} placeholder="Rua das Flores, 123" full />
              <Campo label="CEP" value={form.cep} onChange={set("cep")} placeholder="00000-000" />
              <Campo label="Cidade" value={form.cidade} onChange={set("cidade")} placeholder="São Paulo" />
              <Campo label="Estado" value={form.estado} onChange={set("estado")} placeholder="SP" />
              <div className="col-span-2">
                <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">Observações</label>
                <textarea value={form.observacoes} onChange={(e) => set("observacoes")(e.target.value)}
                  placeholder="Preferências, histórico, etc..."
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-gray-900 font-medium focus:outline-none focus:border-gray-400 resize-none" />
              </div>
            </div>
          ) : (
            /* ── Visualização ── */
            <div className="space-y-4">
              {/* Contato */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Contato</p>
                {[
                  { icon: Phone, label: cliente.telefone, href: cliente.telefone ? `tel:${cliente.telefone}` : undefined },
                  { icon: Mail,  label: cliente.email,    href: cliente.email ? `mailto:${cliente.email}` : undefined },
                  { icon: FileText, label: cliente.cpf,   href: undefined },
                ].map(({ icon: Icon, label, href }) => label ? (
                  <div key={label} className="flex items-center gap-3">
                    <Icon size={14} className="text-gray-400 flex-shrink-0" />
                    {href
                      ? <a href={href} className="text-sm font-bold text-blue-600 hover:underline">{label}</a>
                      : <span className="text-sm font-bold text-gray-700">{label}</span>
                    }
                  </div>
                ) : null)}
              </div>

              {/* Endereço */}
              {(cliente.endereco || cliente.cidade) && (
                <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Endereço</p>
                  <div className="flex items-start gap-3">
                    <MapPin size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                    <div>
                      {cliente.endereco && <p className="text-sm font-bold text-gray-700">{cliente.endereco}</p>}
                      {(cliente.cidade || cliente.estado) && (
                        <p className="text-xs text-gray-500">{[cliente.cidade, cliente.estado].filter(Boolean).join(" — ")} {cliente.cep && `· ${cliente.cep}`}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Observações */}
              {cliente.observacoes && (
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Observações</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{cliente.observacoes}</p>
                </div>
              )}
            </div>
          )}

          {/* Histórico de compras */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">
              Histórico de Compras
              <span className="ml-2 text-gray-300">({cliente.veiculos.length})</span>
            </p>
            {cliente.veiculos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-2xl text-gray-300">
                <Car size={28} className="mb-2" />
                <p className="text-xs font-bold">Nenhuma compra registrada</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cliente.veiculos.map((v) => (
                  <div key={v.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-2xl">
                    <div>
                      <p className="text-sm font-black text-gray-900 uppercase italic tracking-tight">
                        {v.marca} {v.modelo}
                      </p>
                      <p className="text-[10px] text-gray-400 font-bold">
                        {v.ano_modelo ?? "—"}
                        {v.data_venda && ` · ${new Date(v.data_venda + "T12:00:00").toLocaleDateString("pt-BR")}`}
                      </p>
                    </div>
                    <p className="text-sm font-black text-green-600">{fmt(v.preco_venda_final)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex-shrink-0 border-t border-gray-100 p-5">
          {editando ? (
            <button onClick={salvar} disabled={saving || !form.nome.trim()}
              className="w-full py-3.5 bg-gray-900 hover:bg-green-600 disabled:opacity-40 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Salvar Alterações
            </button>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => setEditando(true)}
                className="flex-1 py-3.5 bg-gray-900 hover:bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors">
                Editar Cliente
              </button>
              {confirmDel ? (
                <button onClick={() => onDelete(cliente.id)}
                  className="px-5 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors whitespace-nowrap">
                  Confirmar exclusão
                </button>
              ) : (
                <button onClick={() => setConfirmDel(true)}
                  className="p-3.5 border border-gray-200 hover:border-red-300 hover:bg-red-50 rounded-2xl transition-colors">
                  <Trash2 size={15} className="text-gray-400" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Modal Novo Cliente ───────────────────────────────────────────────────────

function ModalNovo({ onClose, onSave }: {
  onClose: () => void;
  onSave: (form: ClienteForm) => Promise<void>;
}) {
  const [form, setForm] = useState<ClienteForm>(FORM_VAZIO);
  const [saving, setSaving] = useState(false);

  function set(field: keyof ClienteForm) {
    return (v: string) => setForm((p) => ({ ...p, [field]: v }));
  }

  async function salvar() {
    if (!form.nome.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <p className="font-black uppercase italic tracking-tight text-gray-900">Novo Cliente</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">Cadastro de cliente</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl"><X size={16} className="text-gray-400" /></button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
          <Campo label="Nome completo *" value={form.nome} onChange={set("nome")} placeholder="João da Silva" full />
          <Campo label="CPF" value={form.cpf} onChange={set("cpf")} placeholder="000.000.000-00" />
          <Campo label="Telefone" value={form.telefone} onChange={set("telefone")} placeholder="(11) 99999-9999" />
          <Campo label="E-mail" value={form.email} onChange={set("email")} placeholder="joao@email.com" full />
          <Campo label="Endereço" value={form.endereco} onChange={set("endereco")} placeholder="Rua das Flores, 123" full />
          <Campo label="CEP" value={form.cep} onChange={set("cep")} placeholder="00000-000" />
          <Campo label="Cidade" value={form.cidade} onChange={set("cidade")} placeholder="São Paulo" />
          <Campo label="Estado" value={form.estado} onChange={set("estado")} placeholder="SP" />
          <div className="col-span-2">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">Observações</label>
            <textarea value={form.observacoes} onChange={(e) => set("observacoes")(e.target.value)}
              placeholder="Preferências, histórico, etc..."
              rows={2}
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-gray-400 resize-none" />
          </div>
        </div>

        <div className="p-6 pt-0">
          <button onClick={salvar} disabled={saving || !form.nome.trim()}
            className="w-full py-4 bg-gray-900 hover:bg-green-600 disabled:opacity-40 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Cadastrar Cliente
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function ClientesPage() {
  const [clientes,    setClientes]    = useState<Cliente[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [busca,       setBusca]       = useState("");
  const [selecionado, setSelecionado] = useState<Cliente | null>(null);
  const [verNovo,     setVerNovo]     = useState(false);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/clientes");
    if (!res.ok) return;
    const data = await res.json();
    setClientes(data);
    setLoading(false);
    setSelecionado((prev) => prev ? data.find((c: Cliente) => c.id === prev.id) ?? null : null);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function criar(form: ClienteForm) {
    const res = await fetch("/api/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const novo = await res.json();
      setClientes((prev) => [novo, ...prev].sort((a, b) => a.nome.localeCompare(b.nome)));
    }
  }

  async function salvar(id: string, fields: Partial<ClienteForm>) {
    const res = await fetch(`/api/clientes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (res.ok) await carregar();
  }

  async function deletar(id: string) {
    await fetch(`/api/clientes/${id}`, { method: "DELETE" });
    setSelecionado(null);
    setClientes((prev) => prev.filter((c) => c.id !== id));
  }

  const filtrados = clientes.filter((c) => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (
      c.nome.toLowerCase().includes(q) ||
      c.cpf?.includes(q) ||
      c.telefone?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.cidade?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 md:p-10 bg-[#f4f4f2] min-h-screen font-sans">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400 mb-1">Gestão</p>
            <h1 className="text-4xl md:text-5xl font-black italic uppercase text-gray-900 leading-none tracking-tighter">
              Clientes
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-gray-400 mt-1">
              {clientes.length} cliente{clientes.length !== 1 ? "s" : ""} cadastrado{clientes.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => setVerNovo(true)}
            className="flex items-center gap-2 px-5 py-3 bg-gray-900 hover:bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors">
            <Plus size={14} /> Novo Cliente
          </button>
        </div>

        {/* Busca */}
        <div className="relative mb-6">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF, telefone, cidade..."
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
          />
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <User size={48} className="mb-4" />
            <p className="font-bold text-sm">{busca ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
            {!busca && (
              <button onClick={() => setVerNovo(true)}
                className="mt-4 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors">
                Cadastrar primeiro cliente
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtrados.map((c) => (
              <button key={c.id} onClick={() => setSelecionado(c)}
                className="bg-white rounded-[1.75rem] border border-gray-100 p-5 text-left hover:shadow-lg hover:border-red-200 hover:-translate-y-0.5 transition-all group">

                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-11 h-11 rounded-2xl ${avatarColor(c.nome)} flex items-center justify-center flex-shrink-0`}>
                    <span className="text-white font-black">{iniciais(c.nome)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-900 truncate tracking-tight">{c.nome}</p>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">
                      {c.cidade ? `${c.cidade}${c.estado ? ` · ${c.estado}` : ""}` : "Sem endereço"}
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-red-400 transition-colors flex-shrink-0 mt-1" />
                </div>

                <div className="space-y-1.5">
                  {c.telefone && (
                    <div className="flex items-center gap-2">
                      <Phone size={11} className="text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-600 font-medium">{c.telefone}</span>
                    </div>
                  )}
                  {c.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={11} className="text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-600 font-medium truncate">{c.email}</span>
                    </div>
                  )}
                  {c.cpf && (
                    <div className="flex items-center gap-2">
                      <FileText size={11} className="text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-600 font-medium">{c.cpf}</span>
                    </div>
                  )}
                </div>

                {c.veiculos.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-50 flex items-center gap-1.5">
                    <Car size={11} className="text-gray-400" />
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                      {c.veiculos.length} compra{c.veiculos.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selecionado && (
        <SlideOver
          cliente={selecionado}
          onClose={() => setSelecionado(null)}
          onSave={salvar}
          onDelete={deletar}
        />
      )}

      {verNovo && (
        <ModalNovo onClose={() => setVerNovo(false)} onSave={criar} />
      )}
    </div>
  );
}
