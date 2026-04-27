import { NextRequest, NextResponse } from "next/server";

const BASE = "https://api.pagar.me/core/v5";

function authHeaders() {
  const key = process.env.PAGARME_API_KEY!;
  return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
