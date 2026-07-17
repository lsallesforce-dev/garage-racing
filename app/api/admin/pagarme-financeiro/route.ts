import { NextRequest, NextResponse } from "next/server";
import { requireAdminSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BASE = "https://api.pagar.me/core/v5";

function authHeaders() {
  const key = process.env.PAGARME_API_KEY!;
  return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

// A conta Pagar.me é COMPARTILHADA (AutoZap + Amigo Racing usam a mesma chave).
// A listagem /orders vem misturada. Filtro por allowlist: só mostra pedidos que o
// AutoZap reconhece como seus — ou porque estão na tabela `pagamentos` (todo
// checkout grava `notas: pagarme:<orderId>:...`), ou porque o pedido novo já veio
// com metadata.app = "autozap" (ver lib/pagarme.ts). Amigo Racing nunca vaza:
// allowlist, não denylist.
const OK = new Set(["autozap"]);

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  // Fetch maior (100) porque, depois de tirar o Amigo Racing, sobram poucos
  // pedidos AutoZap nos 30 mais recentes — a conta recebe muita inscrição de rally.
  const [balanceRes, ordersRes, pagRes] = await Promise.all([
    fetch(`${BASE}/balance`, { headers: authHeaders() }),
    fetch(`${BASE}/orders?size=100&sort=created_at&direction=desc`, { headers: authHeaders() }),
    supabaseAdmin.from("pagamentos").select("notas").like("notas", "pagarme:%"),
  ]);

  const [balance, orders] = await Promise.all([
    balanceRes.ok ? balanceRes.json() : null,
    ordersRes.ok ? ordersRes.json() : null,
  ]);

  // IDs de pedido que o AutoZap gravou (extrai <orderId> de "pagarme:<orderId>:...")
  const idsAutozap = new Set<string>();
  for (const row of pagRes.data ?? []) {
    const m = /^pagarme:([^:]+)/.exec(row.notas ?? "");
    if (m) idsAutozap.add(m[1]);
  }

  const isAutozap = (o: { id?: string; metadata?: { app?: string } }) =>
    (o.id && idsAutozap.has(o.id)) || (o.metadata?.app != null && OK.has(o.metadata.app));

  const todos = (orders?.data ?? []) as Array<{ id?: string; metadata?: { app?: string } }>;
  const somenteAutozap = todos.filter(isAutozap).slice(0, 30);

  // `orders_total`/`orders_ocultos` deixam claro no painel quantos foram filtrados
  // (transações de outros produtos na mesma conta Pagar.me).
  return NextResponse.json({
    balance,
    orders: somenteAutozap,
    orders_ocultos: todos.length - somenteAutozap.length,
  });
}
