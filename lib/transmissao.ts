// lib/transmissao.ts
//
// Núcleo da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO — não
// confundir com a prospecção B2B da Mari em lib/process-prospeccao.ts).
// Lista de transmissão pessoal: anúncio de carro (texto de repasse SEM o
// wa.me do agente) disparado 1-a-1 pros contatos das listas A/B/C, numa
// instância Avisa dedicada, com cadência anti-ban (ver cron/transmissao-envios).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { buscarMediaWeb, resolverFipe, gerarTextoRepasse } from "@/lib/repasse";

/**
 * Mensagem de envio = texto puro do carro, sem saudação (pedido Marcos
 * Repasse 10/07: nada de nome do contato em cima, só a ficha do anúncio).
 * Mantida como função (em vez de usar campanha.texto direto no cron) pra
 * dar um único ponto de ajuste se a formatação do envio precisar mudar de novo.
 */
export function montarMensagemEnvio(_nomeContato: string, textoCampanha: string): string {
  return textoCampanha;
}

// ── Normalização de telefone (padrão BR, igual conceito do lib/avisa.ts) ─────
/** Só dígitos com DDI 55; null se não parecer telefone BR válido. */
export function normalizarTelefone(raw: string): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = "55" + d;   // DDD + fixo/celular
  if (d.length < 12 || d.length > 13 || !d.startsWith("55")) return null;
  return d;
}

// ── Texto da campanha ─────────────────────────────────────────────────────────
/**
 * Gera texto + capa pro disparo de transmissão de um veículo.
 * Reusa gerarTextoRepasse com botPhone=null (sem "💬 Falar com Vendedor") e
 * vitrineUrl=null (sem "🚗 Veja nosso estoque completo") — lista pessoal, só
 * o texto puro do carro (pedido Marcos Repasse 10/07, revoga a decisão de
 * 07/07 de manter a vitrine). Retorna null se o veículo não existir.
 */
export async function gerarTransmissaoCompleto(
  veiculoId: string,
): Promise<{ texto: string; capaUrl: string | null } | null> {
  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();
  if (!carro) return null;

  // config_garage pode ter múltiplas linhas por user_id — nunca .single()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("cidade, estado")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;

  const versaoRica = [carro.versao, carro.motor, carro.combustivel, carro.cambio]
    .filter(Boolean)
    .join(" ")
    .trim();

  // FIPE (valor_fipe do cadastro > parallelum) e média web em paralelo;
  // se mediaWeb falhar (cota Gemini), gera sem ela — nunca aborta
  const [fipe, mediaWeb] = await Promise.all([
    resolverFipe(carro, versaoRica),
    buscarMediaWeb(carro.marca, carro.modelo, versaoRica, carro.ano_modelo).catch((e) => {
      console.warn("⚠️ gerarTransmissaoCompleto: buscarMediaWeb falhou, seguindo sem:", e);
      return null;
    }),
  ]);

  // Cidade com UF ("São José do Rio Preto-SP") — o 📍 do anúncio sai completo
  const cidadeUf = cfg?.cidade
    ? [String(cfg.cidade).trim(), String(cfg.estado ?? "").trim()].filter(Boolean).join("-")
    : null;
  // botPhone=null → sem "Falar com Vendedor". vitrineUrl=null → sem o link do
  // estoque completo no fim (pedido Marcos Repasse 10/07: só o texto do carro).
  const texto = gerarTextoRepasse(carro, fipe, mediaWeb, null, "repasse", null, cidadeUf);
  const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return { texto, capaUrl };
}
