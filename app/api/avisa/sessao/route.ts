// GET  /api/avisa/sessao — estado da sessão Avisa do tenant (barato e seguro: o
//                          /instance/status NÃO inicia sessão, pode ser pollado).
// POST /api/avisa/sessao — gera um QR de pareamento. Só sob clique do usuário e
//                          com throttle: cada chamada inicia sessão na Avisa e
//                          repetir em rajada prende a instância (ver lib/avisa.ts).
//
// O avisa_token NUNCA sai daqui — o browser só recebe estado e o data URL do QR.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { getAvisaInstanceStatus, getAvisaQrCode } from "@/lib/avisa";
import { podeGerarQrAvisa } from "@/lib/redis";

export const dynamic = "force-dynamic";

// config_garage pode ter várias linhas por user — nunca .single() (regra do CLAUDE.md).
async function credsDoTenant(userId: string) {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("avisa_base_url, avisa_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0] ?? null;
  if (!row?.avisa_base_url || !row?.avisa_token) return null;
  return { baseUrl: row.avisa_base_url as string, token: row.avisa_token as string };
}

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const creds = await credsDoTenant(getEffectiveUserId(user!));
  if (!creds) {
    return NextResponse.json({ configurado: false, estado: "sem_credenciais" });
  }

  const status = await getAvisaInstanceStatus(creds);
  return NextResponse.json({
    configurado: true,
    estado: status.estado,      // conectado | sem_sessao | token_invalido | indisponivel
    jid: status.jid ?? null,
    detalhe: status.detalhe,
  });
}

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const creds = await credsDoTenant(userId);
  if (!creds) {
    return NextResponse.json(
      { ok: false, motivo: "sem_credenciais", detalhe: "Preencha a URL base e o token da Avisa antes de conectar." },
      { status: 400 },
    );
  }

  if (!(await podeGerarQrAvisa(userId))) {
    return NextResponse.json(
      { ok: false, motivo: "throttle", detalhe: "Aguarde alguns segundos antes de gerar outro QR." },
      { status: 429 },
    );
  }

  const r = await getAvisaQrCode(creds);
  if (!r.ok) {
    // sessao_presa não é erro do usuário: é a instância travada em Connected sem
    // login, que só o painel da Avisa destrava. 409 pra UI dar a instrução certa.
    const httpStatus = r.motivo === "ja_conectado" ? 200 : r.motivo === "sessao_presa" ? 409 : 502;
    return NextResponse.json(r, { status: httpStatus });
  }
  return NextResponse.json(r);
}
