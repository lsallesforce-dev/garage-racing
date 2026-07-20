// worker-server.ts
// Servidor Express dedicado para o Railway — sem timeout de serverless.
// QStash chama POST /worker, o pipeline roda em background e responde 200 imediatamente.

import express from "express";
import { Receiver } from "@upstash/qstash";
import { executarPipelineMarketing } from "./lib/marketing-pipeline";
import { renderReel } from "./lib/reel-render";
import { supabaseAdmin } from "./lib/supabase-admin";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Verifica a assinatura QStash (quando as chaves estão setadas). true = pode seguir.
function verificaQStash(req: express.Request): Promise<boolean> {
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) {
    return Promise.resolve(true);
  }
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
  });
  return receiver
    .verify({ signature: req.headers["upstash-signature"] as string, body: JSON.stringify(req.body) })
    .then(() => true)
    .catch(() => false);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Render do reel (Remotion + Chrome headless). QStash chama; roda em background.
app.post("/reel", async (req, res) => {
  if (!(await verificaQStash(req))) return res.status(401).json({ error: "Assinatura inválida" });

  const { veiculoId } = req.body;
  if (!veiculoId) return res.status(400).json({ error: "veiculoId obrigatório" });

  const { data: check } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_reel_status")
    .eq("id", veiculoId)
    .single();
  if (check?.marketing_reel_status === "pronto") {
    return res.json({ ok: true, skipped: true });
  }

  res.json({ ok: true, status: "processing" });

  renderReel(veiculoId)
    .then((url) => console.log(`✅ [reel ${veiculoId}] pronto: ${url}`))
    .catch(async (e: any) => {
      const msg = e?.message ?? String(e);
      console.error(`❌ [reel ${veiculoId}] erro:`, msg);
      await supabaseAdmin.from("veiculos").update({ marketing_reel_status: "erro" }).eq("id", veiculoId);
    });
});

app.post("/worker", async (req, res) => {
  // Valida assinatura QStash quando as chaves estiverem configuradas
  if (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY) {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY,
    });
    try {
      await receiver.verify({
        signature: req.headers["upstash-signature"] as string,
        body:      JSON.stringify(req.body),
      });
    } catch {
      return res.status(401).json({ error: "Assinatura inválida" });
    }
  }

  const { veiculoId, roteiroCustomizado, voz, transicao, musicaOverride } = req.body;
  if (!veiculoId) return res.status(400).json({ error: "veiculoId obrigatório" });

  // Idempotência: pula se já está pronto
  const { data: check } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_status")
    .eq("id", veiculoId)
    .single();

  if (check?.marketing_status === "pronto") {
    console.log(`⏭️ [${veiculoId}] Já pronto — skip`);
    return res.json({ ok: true, skipped: true });
  }

  // Responde 200 imediatamente — QStash não precisa esperar o FFmpeg
  res.json({ ok: true, status: "processing" });

  // Roda o pipeline em background (sem timeout!)
  executarPipelineMarketing(
    veiculoId,
    roteiroCustomizado ?? null,
    voz ?? null,
    transicao ?? null,
    musicaOverride ?? null,
  ).then(() => {
    console.log(`✅ [${veiculoId}] Pipeline concluído`);
  }).catch(async (e: any) => {
    const msg = e?.message ?? String(e);
    console.error(`❌ [${veiculoId}] Pipeline erro:`, msg);
    await supabaseAdmin.from("veiculos").update({
      marketing_status:  "erro",
      marketing_roteiro: `ERRO: ${msg.slice(0, 500)}`,
    }).eq("id", veiculoId);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 AutoZap Worker rodando na porta ${PORT}`);
});
