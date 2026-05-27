// app/api/debug/placa-tipos/route.ts
// Testa vários "tipo" da apibrasil em sequência pra descobrir quais
// estão habilitados no plano atual. APAGAR DEPOIS DE RESOLVER.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

const TIPOS_PARA_TESTAR = [
  "fipe-chassi",      // o atual (que tá quebrado)
  "fipe",
  "placa",
  "nacional",
  "completa",
  "basic",
  "agregados",
  "fipe-completa",
  "fipe-chassi-historico",
  "veiculo",
  "carro",
  "consulta",
];

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const placa = (req.nextUrl.searchParams.get("placa") ?? "EPA9097").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!placa || placa.length < 7) {
    return NextResponse.json({ error: "passe ?placa=ABC1234" }, { status: 400 });
  }
  if (!process.env.APIBRASIL_TOKEN) {
    return NextResponse.json({ error: "APIBRASIL_TOKEN não configurado" }, { status: 500 });
  }

  const resultados: any[] = [];

  for (const tipo of TIPOS_PARA_TESTAR) {
    const start = Date.now();
    try {
      const res = await fetch("https://gateway.apibrasil.io/api/v2/consulta/veiculos/credits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.APIBRASIL_TOKEN}`,
        },
        body: JSON.stringify({ tipo, placa, homolog: false }),
      });

      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}

      const providerMsg = parsed?.data?.providerResponse?.msg ?? parsed?.message ?? null;
      const isOk = res.ok && !parsed?.error;
      const isProviderDisabled = /n[aã]o\s+est[aá]\s+habilitado|n[aã]o\s+existe/i.test(providerMsg ?? "");

      resultados.push({
        tipo,
        status: res.status,
        ok: isOk,
        provider_disabled: isProviderDisabled,
        message: providerMsg?.slice(0, 200) ?? null,
        has_data: !!parsed?.data && Object.keys(parsed?.data ?? {}).length > 0,
        duration_ms: Date.now() - start,
      });

      // Pequena pausa entre tentativas pra não rate-limit
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      resultados.push({
        tipo,
        error: err?.message ?? String(err),
        duration_ms: Date.now() - start,
      });
    }
  }

  const tiposOk = resultados.filter(r => r.ok);
  const tiposHabilitados = resultados.filter(r => !r.provider_disabled && r.status !== 200);

  return NextResponse.json({
    placa,
    user_email: user?.email,
    tipos_funcionando: tiposOk.map(r => r.tipo),
    tipos_provavelmente_habilitados: tiposHabilitados.map(r => r.tipo),
    todos_resultados: resultados,
  });
}
