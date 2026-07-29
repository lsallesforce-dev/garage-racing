// app/api/voz/preview/route.ts
// Amostra da voz do agente para a tela de Configurações. Sintetiza uma frase fixa
// com a voz do tenant e devolve o OGG — assim o dono ouve como o agente vai soar
// ANTES de ligar a feature pra clientes reais.
//
// Frase fixa de propósito: nada vem do corpo da requisição, então não dá pra usar
// esta rota como TTS gratuito nem pra estourar a conta da ElevenLabs com texto longo.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { sintetizarVoz } from "@/lib/tts";

const FRASE = "Oi! Aqui é do atendimento da loja. Vi que você se interessou por um dos nossos carros — me conta o que você está procurando que eu te ajudo.";

export async function POST() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  // config_garage pode ter múltiplas linhas por user_id → pega a mais recente
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("voz_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const voz = await sintetizarVoz(FRASE, { vozId: rows?.[0]?.voz_id ?? undefined });
  if (!voz) {
    return NextResponse.json(
      { error: "Não consegui gerar a amostra. Verifique se a chave da ElevenLabs está configurada." },
      { status: 502 },
    );
  }

  return new NextResponse(new Uint8Array(voz.ogg), {
    headers: {
      "Content-Type": "audio/ogg",
      "Cache-Control": "no-store",
    },
  });
}
