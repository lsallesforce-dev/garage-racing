// app/api/financiamento/simular/route.ts
//
// Consulta manual da página /financiamento: o vendedor digita os dados do
// cliente e escolhe o carro (do estoque ou digitado). Mesmo núcleo da IA
// (dispararSimulacao), sem lead — o resultado aparece só na página.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { dispararSimulacao, type VeiculoPedido } from "@/lib/financiamento-simulacao";
import { rateLimit } from "@/lib/redis";
import { valorDigitado } from "@/lib/financiamento-parcelas";

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const tenant = getEffectiveUserId(user!);

  // Cada consulta custa por banco: trava clique repetido / script.
  const rl = await rateLimit(`fin_painel:${tenant}`, 10, 60).catch(() => ({ allowed: true }));
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas consultas seguidas — espere um minuto" }, { status: 429 });
  }

  const b = await req.json().catch(() => ({}));
  if (b.consentimento !== true) {
    return NextResponse.json({ error: "Confirme que o cliente autorizou a consulta" }, { status: 400 });
  }

  const num = (x: unknown) => {
    const n = valorDigitado(x);
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  // Entrada: vazio = não informada; "0" = sem entrada; ilegível = erro (antes virava 0 calado).
  const entrada = valorDigitado(b.entrada);
  if (entrada != null && Number.isNaN(entrada)) {
    return NextResponse.json({ error: "Não entendi o valor da entrada — use só números, ex.: 57.000" }, { status: 400 });
  }

  let veiculo: VeiculoPedido;
  if (b.veiculoId) {
    veiculo = { id: String(b.veiculoId) };
  } else {
    const valor = num(b.valorVeiculo);
    if (!valor) return NextResponse.json({ error: "Informe o valor do veículo" }, { status: 400 });
    veiculo = {
      placa: b.placa ? String(b.placa) : undefined,
      marca: b.marca ? String(b.marca) : undefined,
      modelo: b.modelo ? String(b.modelo) : undefined,
      ano: num(b.ano) ?? undefined,
      valor,
      categoria: b.tipo === "moto" ? "moto" : b.tipo === "pesado" ? "pesado" : undefined,
    };
  }

  const r = await dispararSimulacao({
    tenant,
    origem: "painel",
    cpf: String(b.cpf ?? ""),
    nascimento: String(b.nascimento ?? ""),
    celular: String(b.celular ?? ""),
    entrada,
    veiculo,
    bancosEscolhidos: Array.isArray(b.bancos) ? b.bancos.map(String) : undefined,
    clienteNome: b.nome ? String(b.nome).slice(0, 120) : null,
    criadoPor: user!.id,
  });
  if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.simId });
}
