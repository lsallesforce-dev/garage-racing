import { NextRequest, NextResponse } from "next/server";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { tirarCarroVendidoDoAr } from "@/lib/veiculo-vendido";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const BUCKET = "videos-estoque";
const R2_PREFIX = process.env.R2_PUBLIC_URL ?? "";

function urlToKey(url: string): string | null {
  if (!R2_PREFIX || !url.startsWith(R2_PREFIX)) return null;
  return url.slice(R2_PREFIX.length).replace(/^\//, "");
}

async function deleteFromR2(keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await r2.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
    }));
  } catch (e) {
    // Falha no cleanup de storage não deve bloquear a deleção do registro
    console.error("⚠️ R2 cleanup parcial ao deletar veículo:", e);
  }
}

export async function DELETE(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { user, error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  // Busca as URLs de R2 antes de deletar o registro
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("fotos, video_takes")
    .eq("id", veiculoId)
    .single();

  // Monta lista de keys do R2 a remover (fotos + takes)
  const r2Keys: string[] = [];
  for (const url of [...(veiculo?.fotos ?? []), ...(veiculo?.video_takes ?? [])]) {
    const key = urlToKey(url);
    if (key) r2Keys.push(key);
  }

  // Tira o carro do ar ANTES do delete, igual à venda: pausa o anúncio pago, apaga os
  // posts e fecha o Mercado Livre. Depois do delete o vínculo some (FK de meta_campanhas é
  // ON DELETE SET NULL; ml_item_id vive na própria linha) e o anúncio ficaria no ar sozinho.
  // A Carmatti APAGA carro vendido em vez de marcar VENDIDO: o Ka 1.5 seguiu ativo no ML
  // sem carro no estoque até ser fechado à mão (25/11/2026).
  const fora = await tirarCarroVendidoDoAr(veiculoId, userId);
  if (fora.pausadas || fora.falhas || fora.mlFechado || fora.mlPendente || fora.pendentes?.length) {
    console.log(`🗑️ [deletar] veículo ${veiculoId} tirado do ar:`, JSON.stringify(fora));
  }

  // Desvíncula referências em outras tabelas, apaga o registro e limpa o R2
  await supabaseAdmin.from("vendas_concluidas").update({ veiculo_id: null }).eq("veiculo_id", veiculoId);
  await supabaseAdmin.from("leads").update({ veiculo_id: null }).eq("veiculo_id", veiculoId);
  await supabaseAdmin.from("veiculos").delete().eq("id", veiculoId);
  await deleteFromR2(r2Keys);

  console.log(`🗑️ Veículo ${veiculoId} deletado — ${r2Keys.length} arquivo(s) removido(s) do R2`);
  return NextResponse.json({ ok: true, r2_removidos: r2Keys.length });
}
