// GET /api/marketing/cota — uso de Kits de Postagem no mês (contador da aba Kits).
import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { usoKits } from "@/lib/kit-cota";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  try {
    return NextResponse.json(await usoKits(getEffectiveUserId(user!)));
  } catch {
    return NextResponse.json({ usados: 0, limite: null, plano: null });
  }
}
