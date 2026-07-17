const BASE = "https://api.pagar.me/core/v5";

function authHeaders() {
  const key = process.env.PAGARME_API_KEY!;
  const encoded = Buffer.from(`${key}:`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function parsePhone(telefone: string) {
  const d = telefone.replace(/\D/g, "");
  return { country_code: "55", area_code: d.slice(0, 2), number: d.slice(2) };
}

export interface PagarmeCustomer {
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

function buildCustomer(c: PagarmeCustomer, withAddress = false) {
  const isCnpj = c.tipoDocumento === "cnpj";
  const customer: Record<string, unknown> = {
    name: c.nome,
    email: c.email,
    type: isCnpj ? "company" : "individual",
    document: c.documento.replace(/\D/g, ""),
    document_type: isCnpj ? "CNPJ" : "CPF",
    phones: { mobile_phone: parsePhone(c.telefone) },
  };
  if (withAddress && c.cep) {
    customer.address = {
      line_1: `${c.numero ?? "S/N"} ${c.logradouro ?? ""}`.trim(),
      line_2: c.bairro ?? "",
      zip_code: c.cep.replace(/\D/g, ""),
      city: c.cidade ?? "",
      state: c.estado ?? "",
      country: "BR",
    };
  }
  return customer;
}

// PagarMe v5 exige `code` (identificador do item) em cada item do pedido.
// Sem ele, a cobrança de boleto/cartão falha com "The item Code is required".
function itemCode(description: string): string {
  return (
    description.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plano"
  );
}

// ─── PIX ──────────────────────────────────────────────────────────────────────

export async function createPixOrder(params: {
  amount: number; // centavos
  description: string;
  customer: PagarmeCustomer;
}) {
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      items: [{ code: itemCode(params.description), amount: params.amount, description: params.description, quantity: 1 }],
      customer: buildCustomer(params.customer),
      payments: [{ payment_method: "pix", pix: { expires_in: 3600 } }],
      // Marca o pedido como AutoZap: a conta Pagar.me é compartilhada com o
      // Amigo Racing; o painel admin filtra por isso (ver pagarme-financeiro).
      metadata: { app: "autozap" },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Erro PagarMe PIX");
  const tx = data.charges?.[0]?.last_transaction;
  const pixText: string = tx?.pix_qr_code ?? tx?.qr_code ?? "";
  // Gera imagem do QR code via serviço público a partir do código EMV
  const qrImageUrl = pixText
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixText)}`
    : "";
  return {
    order_id: data.id as string,
    qr_code: qrImageUrl,
    qr_code_text: pixText,
  };
}

// ─── Boleto ───────────────────────────────────────────────────────────────────

export async function createBoletoOrder(params: {
  amount: number;
  description: string;
  customer: PagarmeCustomer;
  due_at: string; // ISO date
}) {
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      items: [{ code: itemCode(params.description), amount: params.amount, description: params.description, quantity: 1 }],
      customer: buildCustomer(params.customer, true),
      payments: [
        {
          payment_method: "boleto",
          boleto: {
            bank: "033",
            instructions: params.description,
            due_at: params.due_at,
            document_number: Date.now().toString().slice(-10),
          },
        },
      ],
      metadata: { app: "autozap" }, // conta Pagar.me compartilhada — ver pagarme-financeiro
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Erro PagarMe Boleto");
  const tx = data.charges?.[0]?.last_transaction;
  return {
    order_id: data.id as string,
    boleto_url: tx?.url as string,
    boleto_barcode: tx?.line as string,
    boleto_pdf: tx?.pdf as string,
  };
}

// ─── Cartão (checkout hospedado) ──────────────────────────────────────────────

export async function createCardCheckout(params: {
  amount: number;
  description: string;
  customer: PagarmeCustomer;
  installments: number; // 1 ou 12
  success_url: string;
}) {
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      items: [{ code: itemCode(params.description), amount: params.amount, description: params.description, quantity: 1 }],
      customer: buildCustomer(params.customer),
      payments: [
        {
          payment_method: "checkout",
          checkout: {
            expires_in: 120,
            billing_address_editable: true,
            customer_editable: false,
            accepted_payment_methods: ["credit_card"],
            success_url: params.success_url,
            credit_card: {
              capture: true,
              statement_descriptor: "AUTOZAP",
              installments: [{ number: params.installments, total: params.amount }],
            },
          },
        },
      ],
      metadata: { app: "autozap" }, // conta Pagar.me compartilhada — ver pagarme-financeiro
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Erro PagarMe Cartão");
  const checkout = data.checkouts?.[0];
  return {
    order_id: data.id as string,
    checkout_url: checkout?.payment_url as string,
  };
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getOrderStatus(orderId: string): Promise<string> {
  const res = await fetch(`${BASE}/orders/${orderId}`, { headers: authHeaders() });
  const data = await res.json();
  return data.status as string;
}
