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
  cpf: string;
  telefone: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
}

function buildCustomer(c: PagarmeCustomer, withAddress = false) {
  const customer: Record<string, unknown> = {
    name: c.nome,
    email: c.email,
    type: "individual",
    document: c.cpf.replace(/\D/g, ""),
    document_type: "CPF",
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
      items: [{ amount: params.amount, description: params.description, quantity: 1 }],
      customer: buildCustomer(params.customer),
      payments: [{ payment_method: "pix", pix: { expires_in: 3600 } }],
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
      items: [{ amount: params.amount, description: params.description, quantity: 1 }],
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
      items: [{ amount: params.amount, description: params.description, quantity: 1 }],
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
              // Passa todas as opções de 1x até o máximo permitido.
              // O total é o mesmo em todas (desconto já aplicado no preço anual).
              installments: Array.from(
                { length: params.installments },
                (_, i) => ({ number: i + 1, total: params.amount })
              ),
            },
          },
        },
      ],
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
