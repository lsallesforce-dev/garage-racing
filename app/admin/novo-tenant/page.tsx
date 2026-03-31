"use client";

import { useState } from "react";

export default function NovoTenantPage() {
  const [secret, setSecret] = useState("");
  const [autenticado, setAutenticado] = useState(false);
  const [form, setForm] = useState({
    email: "",
    senha: "",
    nome_empresa: "",
    nome_agente: "",
    endereco: "",
    whatsapp: "",
    webhook_token: "",
  });
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; webhook_url?: string; error?: string } | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResultado(null);

    const res = await fetch("/api/admin/create-tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setResultado(data.ok ? { ok: true, webhook_url: data.webhook_url } : { ok: false, error: data.error });
    setLoading(false);

    if (data.ok) {
      setForm({ email: "", senha: "", nome_empresa: "", nome_agente: "", endereco: "", whatsapp: "", webhook_token: "" });
    }
  }

  if (!autenticado) {
    return (
      <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
          <h2 className="text-[13px] font-black uppercase tracking-[0.2em] text-gray-900 mb-6">
            Área Administrativa
          </h2>
          <div className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Senha de administrador"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
            <button
              onClick={() => secret.length > 0 && setAutenticado(true)}
              className="bg-[#CC0000] hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors"
            >
              Entrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4 py-10">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        <h2 className="text-[13px] font-black uppercase tracking-[0.2em] text-gray-900 mb-1">
          Novo Tenant
        </h2>
        <p className="text-[11px] text-gray-400 mb-6">Criar acesso para um novo cliente</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {[
            { name: "email", label: "E-mail", type: "email", required: true },
            { name: "senha", label: "Senha", type: "password", required: true },
            { name: "nome_empresa", label: "Nome da Empresa", type: "text", required: true },
            { name: "nome_agente", label: "Nome do Agente IA", type: "text", required: false },
            { name: "whatsapp", label: "WhatsApp (ex: 5511999999999)", type: "text", required: false },
            { name: "endereco", label: "Endereço", type: "text", required: false },
            { name: "webhook_token", label: "Token do Webhook", type: "text", required: true },
          ].map(({ name, label, type, required }) => (
            <div key={name} className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                {label}{required && " *"}
              </label>
              <input
                type={type}
                name={name}
                required={required}
                value={form[name as keyof typeof form]}
                onChange={handleChange}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
            </div>
          ))}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-[#CC0000] hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors"
          >
            {loading ? "Criando..." : "Criar Tenant"}
          </button>
        </form>

        {resultado && (
          <div className={`mt-6 rounded-xl px-4 py-3 ${resultado.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            {resultado.ok ? (
              <div className="flex flex-col gap-1">
                <p className="text-green-700 text-[11px] font-black uppercase tracking-widest">Tenant criado!</p>
                <p className="text-[11px] text-gray-600 mt-1 break-all">
                  <span className="font-bold">Webhook URL:</span><br />
                  {resultado.webhook_url}
                </p>
              </div>
            ) : (
              <p className="text-red-600 text-[11px] font-bold">{resultado.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
