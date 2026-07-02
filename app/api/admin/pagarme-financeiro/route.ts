import { NextRequest, NextResponse } from "next/server";
import { requireAdminSecret } from "@/lib/api-auth";

const BASE = "https://api.pagar.me/core/v5";

function authHeaders() {
  const key = process.env.PAGARME_API_KEY!;
  return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const [balanceRes, ordersRes] = await Promise.all([
    fetch(`${BASE}/balance`, { headers: authHeaders() }),
    fetch(`${BASE}/orders?size=30&sort=created_at&direction=desc`, { headers: authHeaders() }),
  ]);

  const [balance, orders] = await Promise.all([
    balanceRes.ok ? balanceRes.json() : null,
    ordersRes.ok ? ordersRes.json() : null,
  ]);

  return NextResponse.json({ balance, orders: orders?.data ?? [] });
}
