// lib/pagbank.ts — cliente PagBank (API de Orders + Checkout hospedado), sem SDK.
//
// Substitui lib/pagarme.ts no recebimento das assinaturas. Mantém o MESMO formato
// de retorno (order_id, qr_code, qr_code_text, boleto_*, checkout_url) pra o
// /assinar não mudar, e normaliza o status pra "paid" | "pending" | "failed".
//
// Envs: PAGBANK_TOKEN (Bearer da conta), PAGBANK_ENV = "sandbox" | "production".
// reference_id de todo pedido = id da linha em `pagamentos` (uuid) — é por ele que
// o webhook acha o pagamento, nunca pelo payload cru.
//
// Docs: https://developer.pagbank.com.br/reference/criar-pedido
//       https://developer.pagbank.com.br/reference/criar-checkout
//       https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao

import { createHash, timingSafeEqual } from "crypto";

const BASE =
  process.env.PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

function headers() {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) throw new Error("PAGBANK_TOKEN não configurado");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", accept: "application/json" };
}

export interface PagbankCustomer {
  nome: string;
  email: string;
  documento: string;
  tipoDocumento?: "cpf" | "cnpj";
  telefone: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
}

function soDigitos(v?: string) {
  return (v ?? "").replace(/\D/g, "");
}

function buildCustomer(c: PagbankCustomer) {
  const tel = soDigitos(c.telefone).replace(/^55(?=\d{10,11}$)/, "");
  return {
    name: c.nome.trim().slice(0, 120),
    email: c.email.trim(),
    tax_id: soDigitos(c.documento),
    phones: tel.length >= 10 ? [{ country: "55", area: tel.slice(0, 2), number: tel.slice(2), type: "MOBILE" }] : undefined,
  };
}

function notificationUrls(): string[] {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.autozap.digital";
  return [`${site}/api/pagbank/webhook`];
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(), cache: "no-store" });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }
  if (!res.ok) {
    const msgs = (data as { error_messages?: { description?: string; parameter_name?: string }[] })?.error_messages;
    const msg = msgs?.map((m) => `${m.parameter_name ?? ""} ${m.description ?? ""}`.trim()).join("; ");
    throw new Error(`PagBank ${res.status}: ${msg || text.slice(0, 200)}`);
  }
  return data as T;
}

interface Link { rel: string; href: string; media?: string; type?: string }
interface Charge { id: string; status: string; amount?: { value: number }; payment_method?: { boleto?: { barcode?: string; formatted_barcode?: string } }; links?: Link[] }
interface Order {
  id: string;
  reference_id?: string;
  qr_codes?: { id: string; text: string; amount?: { value: number }; links?: Link[] }[];
  charges?: Charge[];
}

function item(description: string, amount: number) {
  return [{ reference_id: "autozap", name: description.slice(0, 64), quantity: 1, unit_amount: amount }];
}

// ─── PIX ──────────────────────────────────────────────────────────────────────
export async function createPixOrder(p: { referenceId: string; amount: number; description: string; customer: PagbankCustomer }) {
  const expira = new Date(Date.now() + 3600 * 1000).toISOString();
  const o = await call<Order>("/orders", {
    method: "POST",
    body: JSON.stringify({
      reference_id: p.referenceId,
      customer: buildCustomer(p.customer),
      items: item(p.description, p.amount),
      qr_codes: [{ amount: { value: p.amount }, expiration_date: expira }],
      notification_urls: notificationUrls(),
    }),
  });
  const qr = o.qr_codes?.[0];
  const png = qr?.links?.find((l) => l.rel?.toUpperCase().includes("PNG"))?.href;
  return {
    order_id: o.id,
    qr_code_text: qr?.text ?? "",
    qr_code: png ?? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr?.text ?? "")}`,
  };
}

// ─── Boleto ───────────────────────────────────────────────────────────────────
export async function createBoletoOrder(p: { referenceId: string; amount: number; description: string; customer: PagbankCustomer; due_date: string }) {
  const c = p.customer;
  const o = await call<Order>("/orders", {
    method: "POST",
    body: JSON.stringify({
      reference_id: p.referenceId,
      customer: buildCustomer(c),
      items: item(p.description, p.amount),
      notification_urls: notificationUrls(),
      charges: [{
        reference_id: p.referenceId,
        description: p.description.slice(0, 64),
        amount: { value: p.amount, currency: "BRL" },
        payment_method: {
          type: "BOLETO",
          boleto: {
            due_date: p.due_date,
            instruction_lines: { line_1: "AutoZap — assinatura", line_2: "Não receber após o vencimento" },
            holder: {
              name: c.nome.trim().slice(0, 120),
              tax_id: soDigitos(c.documento),
              email: c.email.trim(),
              address: {
                street: c.logradouro ?? "",
                number: c.numero || "S/N",
                locality: c.bairro ?? "",
                city: c.cidade ?? "",
                region_code: (c.estado ?? "").toUpperCase(),
                country: "BRA",
                postal_code: soDigitos(c.cep),
              },
            },
          },
        },
      }],
    }),
  });
  const ch = o.charges?.[0];
  const pdf = ch?.links?.find((l) => (l.media ?? l.type ?? "").includes("pdf"))?.href;
  const png = ch?.links?.find((l) => (l.media ?? l.type ?? "").includes("png"))?.href;
  return {
    order_id: o.id,
    boleto_barcode: ch?.payment_method?.boleto?.formatted_barcode ?? ch?.payment_method?.boleto?.barcode ?? "",
    boleto_url: pdf ?? png ?? "",
    boleto_pdf: pdf ?? "",
  };
}

// ─── Cartão (Checkout hospedado) ─────────────────────────────────────────────
export async function createCardCheckout(p: {
  referenceId: string; amount: number; description: string; customer: PagbankCustomer; installments: number; redirect_url: string;
}) {
  const ck = await call<{ id: string; links?: Link[] }>("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      reference_id: p.referenceId,
      customer: buildCustomer(p.customer),
      customer_modifiable: true,
      items: item(p.description, p.amount),
      payment_methods: [{ type: "CREDIT_CARD" }],
      payment_methods_configs: [{
        type: "CREDIT_CARD",
        config_options: [
          { option: "INSTALLMENTS_LIMIT", value: String(p.installments) },
          { option: "INTEREST_FREE_INSTALLMENTS", value: String(p.installments) },
        ],
      }],
      soft_descriptor: "AUTOZAP",
      redirect_url: p.redirect_url,
      notification_urls: notificationUrls(),
      payment_notification_urls: notificationUrls(),
      expiration_date: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    }),
  });
  const pay = ck.links?.find((l) => l.rel?.toUpperCase() === "PAY")?.href;
  if (!pay) throw new Error("PagBank não retornou o link de pagamento");
  return { order_id: ck.id, checkout_url: pay };
}

// ─── Consulta ─────────────────────────────────────────────────────────────────
export type StatusNormalizado = "paid" | "pending" | "failed";

export interface PedidoConsultado {
  id: string;
  referenceId: string | null;
  status: StatusNormalizado;
  valorPago: number; // centavos
}

/** Consulta o pedido na API (fonte da verdade — nunca confiar no payload do webhook). */
export async function getOrder(orderId: string): Promise<PedidoConsultado> {
  const o = await call<Order>(`/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
  const charges = o.charges ?? [];
  const pagas = charges.filter((c) => c.status === "PAID");
  const falhou = charges.length > 0 && charges.every((c) => ["DECLINED", "CANCELED"].includes(c.status));
  return {
    id: o.id,
    referenceId: o.reference_id ?? null,
    status: pagas.length ? "paid" : falhou ? "failed" : "pending",
    valorPago: pagas.reduce((s, c) => s + (c.amount?.value ?? 0), 0),
  };
}

/**
 * Valida o header x-authenticity-token: SHA-256 hex de `${PAGBANK_TOKEN}-${rawBody}`
 * (corpo BRUTO, sem re-serializar). Comparação em tempo constante.
 */
export function assinaturaValida(rawBody: string, header: string | null): boolean {
  const token = process.env.PAGBANK_TOKEN;
  if (!token || !header) return false;
  const esperado = createHash("sha256").update(`${token}-${rawBody}`).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(header.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
