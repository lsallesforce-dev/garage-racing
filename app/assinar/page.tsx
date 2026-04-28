"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  QrCode, FileText, CreditCard, CheckCircle2, Copy, Loader2,
  ChevronRight, Tag, Building2, Shield, Zap,
} from "lucide-react";
import Image from "next/image";

// ─── Preços ────────────────────────────────────────────────────────────────────

const PLANOS: Record<string, { nome: string; mensal: number; anual12x: number; parcela12x: number; destaque?: string }> = {
  starter: { nome: "Starter",  mensal: 1150,  anual12x: 12420,  parcela12x: 1035 },
  pro:     { nome: "Pro",      mensal: 1500,  anual12x: 16200,  parcela12x: 1350 },
  premium: { nome: "Premium",  mensal: 2135,  anual12x: 23220,  parcela12x: 1935, destaque: "50 NFs/mês incluídas" },
};

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function maskInput(value: string, type: "cpf" | "phone" | "cep") {
  const d = value.replace(/\D/g, "");
  if (type === "cpf")   return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4").slice(0, 14);
  if (type === "phone") return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3").slice(0, 15);
  if (type === "cep")   return d.replace(/(\d{5})(\d{3})/, "$1-$2").slice(0, 9);
  return value;
}

const inputCls = "w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition";
const labelCls = "block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5";

type Metodo = "pix" | "boleto" | "cartao";
type Parcelamento = "mensal" | "anual12x";
type Step = "form" | "pix" | "boleto";

interface Customer {
  nome: string; email: string; cpf: string; telefone: string;
  cep: string; logradouro: string; numero: string; bairro: string; cidade: string; estado: string;
}
interface PixResult    { order_id: string; qr_code: string; qr_code_text: string }
interface BoletoResult { order_id: string; boleto_url: string; boleto_barcode: string; boleto_pdf: string }

// ─── Componente interno ────────────────────────────────────────────────────────

function AssinarContent() {
  const params = useSearchParams();
  const router = useRouter();

  const [planoId,      setPlanoId]      = useState(params.get("plano") ?? "pro");
  const plano = PLANOS[planoId] ?? PLANOS.pro;

  const [metodo,       setMetodo]       = useState<Metodo>("pix");
  const [parcelamento, setParcelamento] = useState<Parcelamento>("mensal");
  const [step,         setStep]         = useState<Step>("form");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [pixResult,    setPixResult]    = useState<PixResult | null>(null);
  const [boletoResult, setBoletoResult] = useState<BoletoResult | null>(null);
  const [copied,       setCopied]       = useState(false);
  const [pixStatus,    setPixStatus]    = useState<"pendente" | "pago">("pendente");

  const [customer, setCustomer] = useState<Customer>({
    nome: "", email: "", cpf: "", telefone: "",
    cep: "", logradouro: "", numero: "", bairro: "", cidade: "", estado: "",
  });

  useEffect(() => {
    import("@/lib/supabase").then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user?.email)               setCustomer(c => ({ ...c, email: data.user!.email! }));
        if (data.user?.user_metadata?.nome) setCustomer(c => ({ ...c, nome:  data.user!.user_metadata.nome }));
      });
    });
  }, []);

  async function fetchCep(cep: string) {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) setCustomer(c => ({
        ...c,
        logradouro: data.logradouro ?? c.logradouro,
        bairro:     data.bairro     ?? c.bairro,
        cidade:     data.localidade ?? c.cidade,
        estado:     data.uf         ?? c.estado,
      }));
    } catch { /* silencioso */ }
  }

  const pollPix = useCallback(async (orderId: string) => {
    if (pixStatus === "pago") return;
    try {
      const res  = await fetch(`/api/pagarme/status/${orderId}`);
      const data = await res.json();
      if (data.status === "paid" || data.status === "pago") {
        setPixStatus("pago");
        setTimeout(() => router.push(`/assinar/sucesso?plano=${planoId}`), 1500);
      }
    } catch { /* silencioso */ }
  }, [pixStatus, planoId, router]);

  useEffect(() => {
    if (step !== "pix" || !pixResult || pixStatus === "pago") return;
    const id = setInterval(() => pollPix(pixResult.order_id), 5000);
    return () => clearInterval(id);
  }, [step, pixResult, pixStatus, pollPix]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/pagarme/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: planoId, metodo, parcelamento, customer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao processar");

      if (metodo === "pix") {
        setPixResult(data as PixResult);
        setStep("pix");
      } else if (metodo === "boleto") {
        setBoletoResult(data as BoletoResult);
        setStep("boleto");
      } else if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Tela PIX ──────────────────────────────────────────────────────────────────
  if (step === "pix" && pixResult) {
    return (
      <div className="min-h-screen bg-[#efefed] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8 text-center">
          {pixStatus === "pago" ? (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={32} className="text-green-600" />
              </div>
              <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 mb-2">Pago!</h2>
              <p className="text-gray-400 text-sm">Redirecionando…</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 justify-center mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">AutoZap · Plano {plano.nome}</span>
              </div>
              <p className="text-2xl font-black text-gray-900 mb-6">
                {fmt(metodo === "cartao" && parcelamento === "anual12x" ? plano.parcela12x : plano.mensal)}
                <span className="text-sm font-normal text-gray-400">/mês</span>
              </p>
              <div className="bg-gray-50 rounded-2xl p-4 mb-4 flex items-center justify-center">
                {pixResult.qr_code ? (
                  <Image src={pixResult.qr_code} alt="QR Code PIX" width={200} height={200}
                    className="rounded-xl" unoptimized />
                ) : (
                  <div className="w-[200px] h-[200px] bg-gray-100 rounded-xl flex items-center justify-center">
                    <QrCode size={48} className="text-gray-300" />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mb-4 font-bold uppercase tracking-widest">
                Expira em 1 hora · Verificando automaticamente
              </p>
              <button onClick={() => copyText(pixResult.qr_code_text)}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-red-600 text-white rounded-2xl py-3 text-[11px] font-black uppercase tracking-widest transition">
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                {copied ? "Copiado!" : "Copiar código PIX"}
              </button>
              <div className="mt-4 flex items-center justify-center gap-2 text-gray-400 text-xs">
                <Loader2 size={12} className="animate-spin" /> Aguardando confirmação…
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Tela Boleto ───────────────────────────────────────────────────────────────
  if (step === "boleto" && boletoResult) {
    return (
      <div className="min-h-screen bg-[#efefed] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8 text-center">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText size={24} className="text-blue-600" />
          </div>
          <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 mb-2">Boleto gerado!</h2>
          <p className="text-gray-400 text-sm mb-6">
            Vence em 7 dias. Plano ativa após compensação (até 3 dias úteis).
          </p>
          {boletoResult.boleto_barcode && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 break-all text-xs text-gray-500 font-mono text-left">
              {boletoResult.boleto_barcode}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {boletoResult.boleto_pdf && (
              <a href={boletoResult.boleto_pdf} target="_blank" rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-red-600 text-white rounded-2xl py-3 text-[11px] font-black uppercase tracking-widest transition">
                <FileText size={14} /> Abrir boleto PDF
              </a>
            )}
            {boletoResult.boleto_barcode && (
              <button onClick={() => copyText(boletoResult.boleto_barcode)}
                className="w-full flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl py-3 text-[11px] font-black uppercase tracking-widest transition">
                {copied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                {copied ? "Copiado!" : "Copiar código de barras"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Formulário ────────────────────────────────────────────────────────────────
  const valorExibido = metodo === "cartao" && parcelamento === "anual12x" ? plano.parcela12x : plano.mensal;

  return (
    <div className="min-h-screen bg-[#efefed] py-12 px-4">
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <span className="text-2xl font-black uppercase italic tracking-tighter">
              <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
            </span>
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter italic text-gray-900">
            Assinar plano {plano.nome}
          </h1>
          <p className="text-gray-400 text-sm mt-2">Trial grátis de 30 dias · Cancele quando quiser</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* Seletor de plano */}
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
            <p className={labelCls}>Plano escolhido</p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {(["starter", "pro", "premium"] as const).map(id => {
                const p = PLANOS[id];
                const badge = id === "pro"     ? { label: "Popular",    cls: "bg-amber-100 text-amber-700" }
                            : id === "premium" ? { label: "NF-e",       cls: "bg-purple-100 text-purple-700" }
                            : null;
                return (
                  <button key={id} type="button" onClick={() => setPlanoId(id)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-2xl border-2 transition ${
                      planoId === id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-100 bg-gray-50 hover:border-gray-300 text-gray-700"
                    }`}>
                    <div className="flex items-center justify-between w-full gap-1">
                      <span className={`text-[11px] font-black uppercase tracking-widest ${planoId === id ? "text-white" : "text-gray-900"}`}>
                        {p.nome}
                      </span>
                      {badge && (
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] ${planoId === id ? "text-white/70" : "text-gray-400"}`}>
                      {fmt(p.mensal)}/mês
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Método de pagamento */}
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
            <p className={labelCls}>Forma de pagamento</p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {([
                { id: "pix",    icon: <QrCode size={18} />,     label: "PIX",    sub: "Instantâneo" },
                { id: "boleto", icon: <FileText size={18} />,   label: "Boleto", sub: "3 dias úteis" },
                { id: "cartao", icon: <CreditCard size={18} />, label: "Cartão", sub: "Parcelado" },
              ] as const).map(({ id, icon, label, sub }) => (
                <button key={id} type="button" onClick={() => setMetodo(id)}
                  className={`flex flex-col items-center gap-1.5 py-4 rounded-2xl border-2 transition ${
                    metodo === id ? "border-red-600 bg-red-50 text-red-600" : "border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300"
                  }`}>
                  {icon}
                  <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
                  <span className="text-[9px] text-gray-400">{sub}</span>
                </button>
              ))}
            </div>

            {/* Toggle mensal / anual — só cartão */}
            {metodo === "cartao" && (
              <div className="mt-4 flex gap-2">
                {([
                  { id: "mensal",   label: `Mensal`,        sub: fmt(plano.mensal) + "/mês",     tag: null },
                  { id: "anual12x", label: `Anual 12x`,     sub: fmt(plano.parcela12x) + "/mês", tag: "10% OFF" },
                ] as const).map(({ id, label, sub, tag }) => (
                  <button key={id} type="button" onClick={() => setParcelamento(id)}
                    className={`flex-1 flex flex-col items-center gap-0.5 py-3 rounded-2xl border-2 transition ${
                      parcelamento === id ? "border-red-600 bg-red-50" : "border-gray-100 bg-gray-50 hover:border-gray-300"
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-black uppercase tracking-widest ${parcelamento === id ? "text-red-600" : "text-gray-700"}`}>
                        {label}
                      </span>
                      {tag && (
                        <span className="flex items-center gap-0.5 text-[8px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                          <Tag size={8} /> {tag}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400">{sub}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Resumo do valor */}
          <div className="bg-gray-900 rounded-[2rem] p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Plano {plano.nome}</p>
              <p className="text-[11px] text-white/40 mt-0.5">
                {metodo === "cartao" && parcelamento === "anual12x"
                  ? `12x · Total ${fmt(plano.anual12x)} · economia de ${fmt(plano.mensal * 12 - plano.anual12x)}`
                  : "Renovação mensal · cancele quando quiser"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-white italic">{fmt(valorExibido)}</p>
              <p className="text-[10px] text-white/40">/mês</p>
            </div>
          </div>

          {/* Dados do titular */}
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 space-y-4">
            <p className={labelCls + " flex items-center gap-2"}>
              <Building2 size={11} /> Dados do titular
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>Nome completo</label>
                <input required value={customer.nome}
                  onChange={e => setCustomer(c => ({ ...c, nome: e.target.value }))}
                  className={inputCls} placeholder="João da Silva" />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input required type="email" value={customer.email}
                  onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))}
                  className={inputCls} placeholder="joao@email.com" />
              </div>
              <div>
                <label className={labelCls}>CPF</label>
                <input required value={customer.cpf}
                  onChange={e => setCustomer(c => ({ ...c, cpf: maskInput(e.target.value, "cpf") }))}
                  className={inputCls} placeholder="000.000.000-00" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Telefone / WhatsApp</label>
                <input required value={customer.telefone}
                  onChange={e => setCustomer(c => ({ ...c, telefone: maskInput(e.target.value, "phone") }))}
                  className={inputCls} placeholder="(11) 99999-9999" />
              </div>
            </div>

            {/* Endereço — apenas para boleto */}
            {metodo === "boleto" && (
              <div className="border-t border-gray-100 pt-4 space-y-4">
                <p className={labelCls}>Endereço para boleto</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>CEP</label>
                    <input required value={customer.cep}
                      onChange={e => {
                        const v = maskInput(e.target.value, "cep");
                        setCustomer(c => ({ ...c, cep: v }));
                        if (v.replace(/\D/g, "").length === 8) fetchCep(v);
                      }}
                      className={inputCls} placeholder="00000-000" />
                  </div>
                  <div>
                    <label className={labelCls}>Número</label>
                    <input required value={customer.numero}
                      onChange={e => setCustomer(c => ({ ...c, numero: e.target.value }))}
                      className={inputCls} placeholder="123" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Logradouro</label>
                    <input required value={customer.logradouro}
                      onChange={e => setCustomer(c => ({ ...c, logradouro: e.target.value }))}
                      className={inputCls} placeholder="Rua das Flores" />
                  </div>
                  <div>
                    <label className={labelCls}>Bairro</label>
                    <input required value={customer.bairro}
                      onChange={e => setCustomer(c => ({ ...c, bairro: e.target.value }))}
                      className={inputCls} placeholder="Centro" />
                  </div>
                  <div>
                    <label className={labelCls}>Cidade</label>
                    <input required value={customer.cidade}
                      onChange={e => setCustomer(c => ({ ...c, cidade: e.target.value }))}
                      className={inputCls} placeholder="São Paulo" />
                  </div>
                  <div>
                    <label className={labelCls}>Estado (UF)</label>
                    <input required maxLength={2} value={customer.estado}
                      onChange={e => setCustomer(c => ({ ...c, estado: e.target.value.toUpperCase() }))}
                      className={inputCls + " uppercase"} placeholder="SP" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm font-bold">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-[12px] transition">
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> Processando…</>
            ) : (
              <>
                {metodo === "pix"    && <><QrCode    size={16} /> Gerar QR Code PIX</>}
                {metodo === "boleto" && <><FileText   size={16} /> Gerar boleto</>}
                {metodo === "cartao" && <><CreditCard size={16} /> Ir para pagamento</>}
                <ChevronRight size={16} />
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
            <span className="flex items-center gap-1"><Shield size={10} /> SSL</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Zap size={10} /> PagarMe</span>
            <span>·</span>
            <span className="flex items-center gap-1"><CheckCircle2 size={10} /> Trial 30 dias</span>
          </div>

        </form>
      </div>
    </div>
  );
}

export default function AssinarPage() {
  return (
    <Suspense>
      <AssinarContent />
    </Suspense>
  );
}
