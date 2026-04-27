"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  QrCode, FileText, CreditCard, CheckCircle2, Copy, Loader2,
  ChevronRight, Tag, Zap, Building2,
} from "lucide-react";
import Image from "next/image";

// ─── Preços ────────────────────────────────────────────────────────────────────

const PLANOS: Record<string, { nome: string; mensal: number; anual12x: number; parcela12x: number }> = {
  starter: { nome: "Starter", mensal: 1150, anual12x: 12420, parcela12x: 1035 },
  pro:     { nome: "Pro",     mensal: 1500, anual12x: 16200, parcela12x: 1350 },
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

type Metodo = "pix" | "boleto" | "cartao";
type Parcelamento = "mensal" | "anual12x";
type Step = "form" | "pix" | "boleto";

interface Customer {
  nome: string; email: string; cpf: string; telefone: string;
  cep: string; logradouro: string; numero: string; bairro: string; cidade: string; estado: string;
}
interface PixResult   { order_id: string; qr_code: string; qr_code_text: string }
interface BoletoResult { order_id: string; boleto_url: string; boleto_barcode: string; boleto_pdf: string }

// ─── Componente interno (usa useSearchParams) ──────────────────────────────────

function AssinarContent() {
  const params     = useSearchParams();
  const router     = useRouter();
  const planoId    = params.get("plano") ?? "pro";
  const plano      = PLANOS[planoId] ?? PLANOS.pro;

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

  // Preenche dados do usuário logado
  useEffect(() => {
    import("@/lib/supabase").then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user?.email)                  setCustomer(c => ({ ...c, email: data.user!.email! }));
        if (data.user?.user_metadata?.nome)    setCustomer(c => ({ ...c, nome:  data.user!.user_metadata.nome }));
      });
    });
  }, []);

  // Autopreenchimento de endereço por CEP
  async function fetchCep(cep: string) {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setCustomer(c => ({
          ...c,
          logradouro: data.logradouro ?? c.logradouro,
          bairro:     data.bairro     ?? c.bairro,
          cidade:     data.localidade ?? c.cidade,
          estado:     data.uf         ?? c.estado,
        }));
      }
    } catch { /* silencioso */ }
  }

  // Polling de confirmação PIX (a cada 5s)
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

  // ── Tela PIX ─────────────────────────────────────────────────────────────────
  if (step === "pix" && pixResult) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-8 text-center">
          {pixStatus === "pago" ? (
            <>
              <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Pagamento confirmado!</h2>
              <p className="text-white/50 text-sm">Redirecionando…</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 justify-center mb-6">
                <QrCode className="w-5 h-5 text-[#00ff88]" />
                <span className="text-white font-semibold">Pague com PIX</span>
              </div>
              {pixResult.qr_code ? (
                <Image src={pixResult.qr_code} alt="QR Code PIX" width={200} height={200}
                  className="mx-auto rounded-xl mb-4" unoptimized />
              ) : (
                <div className="w-[200px] h-[200px] bg-white/10 rounded-xl mx-auto mb-4 flex items-center justify-center">
                  <QrCode className="w-16 h-16 text-white/30" />
                </div>
              )}
              <p className="text-white/50 text-xs mb-4">Expira em 1 hora · Aguardando confirmação…</p>
              <button onClick={() => copyText(pixResult.qr_code_text)}
                className="w-full flex items-center justify-center gap-2 bg-[#00ff88]/10 hover:bg-[#00ff88]/20 border border-[#00ff88]/30 text-[#00ff88] rounded-xl py-3 text-sm font-medium transition">
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copiado!" : "Copiar código PIX"}
              </button>
              <div className="mt-4 flex items-center justify-center gap-2 text-white/30 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" />
                Verificando pagamento automaticamente…
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
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-8 text-center">
          <FileText className="w-12 h-12 text-blue-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Boleto gerado!</h2>
          <p className="text-white/50 text-sm mb-6">
            Vence em 7 dias. O plano ativa após a compensação (até 3 dias úteis).
          </p>
          {boletoResult.boleto_barcode && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-4 break-all text-xs text-white/60 font-mono text-left">
              {boletoResult.boleto_barcode}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {boletoResult.boleto_pdf && (
              <a href={boletoResult.boleto_pdf} target="_blank" rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl py-3 text-sm font-medium transition">
                <FileText className="w-4 h-4" /> Abrir boleto PDF
              </a>
            )}
            {boletoResult.boleto_barcode && (
              <button onClick={() => copyText(boletoResult.boleto_barcode)}
                className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-xl py-3 text-sm font-medium transition">
                {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copiado!" : "Copiar código de barras"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Formulário ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div className="max-w-2xl mx-auto">

        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-[#00ff88]" />
            <span className="text-[#00ff88] text-sm font-semibold tracking-wide uppercase">AutoZap</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Assinar plano {plano.nome}</h1>
          <p className="text-white/50 text-sm">Escolha a forma de pagamento e ative seu plano agora</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Método de pagamento */}
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4">Forma de pagamento</h2>
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "pix",    icon: <QrCode className="w-5 h-5" />,     label: "PIX",    badge: "Instantâneo" },
                { id: "boleto", icon: <FileText className="w-5 h-5" />,   label: "Boleto", badge: "3 dias úteis" },
                { id: "cartao", icon: <CreditCard className="w-5 h-5" />, label: "Cartão", badge: "Parcelado" },
              ] as const).map(({ id, icon, label, badge }) => (
                <button key={id} type="button" onClick={() => setMetodo(id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition ${
                    metodo === id
                      ? "border-[#00ff88] bg-[#00ff88]/10 text-[#00ff88]"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                  }`}>
                  {icon}
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-[10px] opacity-60">{badge}</span>
                </button>
              ))}
            </div>

            {/* Toggle mensal / anual — só cartão */}
            {metodo === "cartao" && (
              <div className="mt-4 flex gap-3">
                {([
                  { id: "mensal",   label: `Mensal — ${fmt(plano.mensal)}/mês`,    tag: null },
                  { id: "anual12x", label: `12x de ${fmt(plano.parcela12x)}`,      tag: "10% OFF — Melhor opção" },
                ] as const).map(({ id, label, tag }) => (
                  <button key={id} type="button" onClick={() => setParcelamento(id)}
                    className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border text-sm transition ${
                      parcelamento === id
                        ? "border-[#00ff88] bg-[#00ff88]/10 text-[#00ff88]"
                        : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                    }`}>
                    {tag && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                        <Tag className="w-3 h-3" /> {tag}
                      </span>
                    )}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Resumo do valor */}
          <div className="bg-[#00ff88]/5 border border-[#00ff88]/20 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-white font-semibold">Plano {plano.nome}</div>
              <div className="text-white/50 text-sm">
                {metodo === "cartao" && parcelamento === "anual12x"
                  ? `12x · Total ${fmt(plano.anual12x)} (economize ${fmt(plano.mensal * 12 - plano.anual12x)})`
                  : `${fmt(plano.mensal)}/mês · renovação mensal`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[#00ff88]">
                {metodo === "cartao" && parcelamento === "anual12x" ? fmt(plano.parcela12x) : fmt(plano.mensal)}
              </div>
              {metodo === "cartao" && parcelamento === "anual12x" && (
                <div className="text-xs text-white/40">por mês</div>
              )}
            </div>
          </div>

          {/* Dados do titular */}
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-white/40" /> Dados do titular
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-white/50 mb-1">Nome completo</label>
                <input required value={customer.nome}
                  onChange={e => setCustomer(c => ({ ...c, nome: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                  placeholder="João da Silva" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">E-mail</label>
                <input required type="email" value={customer.email}
                  onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                  placeholder="joao@email.com" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">CPF</label>
                <input required value={customer.cpf}
                  onChange={e => setCustomer(c => ({ ...c, cpf: maskInput(e.target.value, "cpf") }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                  placeholder="000.000.000-00" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Telefone / WhatsApp</label>
                <input required value={customer.telefone}
                  onChange={e => setCustomer(c => ({ ...c, telefone: maskInput(e.target.value, "phone") }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                  placeholder="(11) 99999-9999" />
              </div>
            </div>

            {/* Endereço — apenas para boleto */}
            {metodo === "boleto" && (
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-3">
                  Endereço para boleto
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-white/50 mb-1">CEP</label>
                    <input required value={customer.cep}
                      onChange={e => {
                        const v = maskInput(e.target.value, "cep");
                        setCustomer(c => ({ ...c, cep: v }));
                        if (v.replace(/\D/g, "").length === 8) fetchCep(v);
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                      placeholder="00000-000" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">Número</label>
                    <input required value={customer.numero}
                      onChange={e => setCustomer(c => ({ ...c, numero: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                      placeholder="123" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-white/50 mb-1">Logradouro</label>
                    <input required value={customer.logradouro}
                      onChange={e => setCustomer(c => ({ ...c, logradouro: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                      placeholder="Rua das Flores" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">Bairro</label>
                    <input required value={customer.bairro}
                      onChange={e => setCustomer(c => ({ ...c, bairro: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                      placeholder="Centro" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">Cidade</label>
                    <input required value={customer.cidade}
                      onChange={e => setCustomer(c => ({ ...c, cidade: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50"
                      placeholder="São Paulo" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">Estado (UF)</label>
                    <input required maxLength={2} value={customer.estado}
                      onChange={e => setCustomer(c => ({ ...c, estado: e.target.value.toUpperCase() }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00ff88]/50 uppercase"
                      placeholder="SP" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#00ff88] hover:bg-[#00dd77] text-black font-bold py-4 rounded-xl text-base transition disabled:opacity-50">
            {loading ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Processando…</>
            ) : (
              <>
                {metodo === "pix"    && <><QrCode    className="w-5 h-5" /> Gerar QR Code PIX</>}
                {metodo === "boleto" && <><FileText   className="w-5 h-5" /> Gerar boleto</>}
                {metodo === "cartao" && <><CreditCard className="w-5 h-5" /> Ir para pagamento</>}
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </button>

          <p className="text-center text-white/30 text-xs">
            Pagamento processado por PagarMe · Dados criptografados · SSL
          </p>
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
