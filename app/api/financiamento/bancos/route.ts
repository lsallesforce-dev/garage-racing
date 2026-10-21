// app/api/financiamento/bancos/route.ts
//
// Acesso da loja aos portais dos bancos, usado pela simulação automática
// (lib/financiamento-simulacao). Senha entra e nunca sai: o GET devolve só
// banco, dica do usuário e último status. Vendedor não mexe — é o acesso do dono.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { cifrar } from "@/lib/segredo";
import { BANCOS_CREDPRO, credproConfigurada, listarBancos } from "@/lib/credpro";

async function dono() {
  const { user, error } = await requireAuth();
  if (error) return { error };
  if (user!.user_metadata?.role === "vendedor") {
    return { error: NextResponse.json({ error: "Só o dono da loja configura o financiamento" }, { status: 403 }) };
  }
  return { userId: getEffectiveUserId(user!) };
}

export async function GET() {
  const a = await dono();
  if (a.error) return a.error;

  const [{ data: bancos }, { data: cfg }, agora] = await Promise.all([
    supabaseAdmin.from("financiamento_bancos")
      .select("banco, usuario_dica, ativo, ultimo_status, ultimo_status_em, retorno_pct")
      .eq("user_id", a.userId),
    supabaseAdmin.from("config_garage").select("financiamento_auto")
      .eq("user_id", a.userId).order("created_at", { ascending: false }).limit(1),
    credproConfigurada() ? listarBancos().catch(() => null) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ligado: cfg?.[0]?.financiamento_auto === true,
    servico: credproConfigurada(),
    bancos: bancos ?? [],
    lista: BANCOS_CREDPRO,
    disponibilidade: agora?.bancos ?? [],
  });
}

export async function POST(req: NextRequest) {
  const a = await dono();
  if (a.error) return a.error;
  const body = await req.json().catch(() => ({}));

  // Liga/desliga a simulação automática do tenant.
  if (typeof body.ligado === "boolean") {
    const { error } = await supabaseAdmin.from("config_garage")
      .update({ financiamento_auto: body.ligado }).eq("user_id", a.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const banco = String(body.banco ?? "");
  if (!(BANCOS_CREDPRO as readonly string[]).includes(banco)) {
    return NextResponse.json({ error: "Banco não suportado" }, { status: 400 });
  }

  // % de retorno da tabela da loja nesse banco (estimativa de comissão).
  // null/"" limpa.
  if ("retorno_pct" in body && !body.senha) {
    const bruto = body.retorno_pct;
    const pct = bruto === null || bruto === "" ? null : Number(String(bruto).replace(",", "."));
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 30)) {
      return NextResponse.json({ error: "Retorno precisa ser um % entre 0 e 30" }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("financiamento_bancos")
      .update({ retorno_pct: pct, updated_at: new Date().toISOString() })
      .eq("user_id", a.userId).eq("banco", banco);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Só pausar/reativar um banco já salvo.
  if (typeof body.ativo === "boolean" && !body.senha) {
    const { error } = await supabaseAdmin.from("financiamento_bancos")
      .update({ ativo: body.ativo, updated_at: new Date().toISOString() })
      .eq("user_id", a.userId).eq("banco", banco);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const usuario = String(body.usuario ?? "").trim();
  const senha = String(body.senha ?? "");
  if (!usuario || !senha) return NextResponse.json({ error: "Informe usuário e senha" }, { status: 400 });

  let credencial: string;
  try {
    credencial = cifrar(JSON.stringify({ usuario, senha }));
  } catch (e) {
    console.error("🚨 [Financiamento] cifra indisponível:", (e as Error).message);
    return NextResponse.json({ error: "Cofre de senhas não configurado no servidor" }, { status: 503 });
  }

  const { error } = await supabaseAdmin.from("financiamento_bancos").upsert({
    user_id: a.userId,
    banco,
    credencial_cifrada: credencial,
    usuario_dica: usuario.slice(0, 3),
    ativo: true,
    ultimo_status: null,
    ultimo_status_em: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,banco" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const a = await dono();
  if (a.error) return a.error;
  const banco = req.nextUrl.searchParams.get("banco") ?? "";
  const { error } = await supabaseAdmin.from("financiamento_bancos")
    .delete().eq("user_id", a.userId).eq("banco", banco);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
