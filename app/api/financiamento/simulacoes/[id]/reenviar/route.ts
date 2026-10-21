// app/api/financiamento/simulacoes/[id]/reenviar/route.ts
//
// Repete uma simulação com os mesmos dados (cliente, carro do estoque,
// entrada). `somenteFalhas` manda só os bancos que deram erro técnico, não
// responderam ou estavam fora do horário — os que já responderam (cobrados)
// não são consultados de novo. Sempre como consulta do painel: reenviar uma
// simulação da IA não manda WhatsApp pro cliente outra vez.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { dispararSimulacao } from "@/lib/financiamento-simulacao";
import { rateLimit } from "@/lib/redis";

const SEM_RESPOSTA = new Set([null, undefined, "erro", "manutencao", "indisponivel"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireAuth();
  if (error) return error;
  const tenant = getEffectiveUserId(user!);

  const rl = await rateLimit(`fin_painel:${tenant}`, 10, 60).catch(() => ({ allowed: true }));
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas consultas seguidas — espere um minuto" }, { status: 429 });
  }

  const { somenteFalhas } = await req.json().catch(() => ({}));
  const { data: sim } = await supabaseAdmin.from("financiamento_simulacoes")
    .select("id, status, veiculo_id, cliente_nome, celular, cpf, nascimento, entrada, bancos, resultado")
    .eq("id", id)
    .eq("user_id", tenant)
    .maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulação não encontrada" }, { status: 404 });
  if (sim.status === "pendente" || sim.status === "processando") {
    return NextResponse.json({ error: "Essa simulação ainda está rodando" }, { status: 409 });
  }
  // Carro digitado na mão não fica guardado inteiro (só a descrição): a
  // página preenche o formulário pra pessoa conferir e mandar de novo.
  if (!sim.veiculo_id) {
    return NextResponse.json({ error: "Carro digitado: reenvie pelo formulário", formulario: true }, { status: 400 });
  }
  if (!sim.celular) {
    return NextResponse.json({ error: "Simulação sem celular: reenvie pelo formulário", formulario: true }, { status: 400 });
  }

  let bancos: string[] = sim.bancos ?? [];
  if (somenteFalhas && sim.resultado?.resultados?.length) {
    bancos = (sim.resultado.resultados as { banco: string; status: string | null }[])
      .filter((r) => SEM_RESPOSTA.has(r.status))
      .map((r) => r.banco);
  }
  if (!bancos.length) return NextResponse.json({ error: "Nenhum banco pra reenviar" }, { status: 400 });

  const r = await dispararSimulacao({
    tenant,
    origem: "painel",
    cpf: sim.cpf,
    nascimento: String(sim.nascimento),
    celular: sim.celular,
    entrada: sim.entrada == null ? null : Number(sim.entrada),
    veiculo: { id: sim.veiculo_id },
    bancosEscolhidos: bancos,
    clienteNome: sim.cliente_nome,
    criadoPor: user!.id,
  });
  if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.simId });
}
