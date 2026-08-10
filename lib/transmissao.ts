// lib/transmissao.ts
//
// Núcleo da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO — não
// confundir com a prospecção B2B da Mari em lib/process-prospeccao.ts).
// Lista de transmissão pessoal: anúncio de carro (texto de repasse SEM o
// wa.me do agente) disparado 1-a-1 pros contatos das listas A/B/C, numa
// instância Avisa dedicada, com cadência anti-ban (ver cron/transmissao-envios).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolverFipe, gerarTextoRepasse, removerRodapes, garantirDisclaimers, garantirCodigo } from "@/lib/repasse";

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
 * Desde 07/08 o gerarTextoRepasse não emite mais rodapé nenhum (nem o wa.me
 * nem a vitrine), então grupo e transmissão saem iguais. Retorna null se o
 * veículo não existir.
 */
// Prospecção é lista PESSOAL: não leva o "💬 Falar com Vendedor" (wa.me do
// agente) nem o "🚗 Veja nosso estoque completo" (vitrine). O texto congelado
// (repasse_texto) é o do repasse, que TEM esses dois blocos — então removemos.
// A remoção em si vive em lib/repasse.ts (removerRodapes), compartilhada com o
// anúncio de grupo — desde 07/08 os dois rodapés saíram de vez da geração e a
// função virou só a rede de segurança pros textos congelados antigos.
const semRodapesProspeccao = (texto: string) =>
  removerRodapes(texto, { cta: false, vitrine: false });

export async function gerarTransmissaoCompleto(
  veiculoId: string,
): Promise<{ texto: string; capaUrl: string | null } | null> {
  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();
  if (!carro) return null;

  // Texto congelado pelo dono (mesma fonte da verdade do repasse): usa VERBATIM.
  // Assim grupo e prospecção mostram EXATAMENTE o texto salvo (pedido Marcos).
  if (typeof carro.repasse_texto === "string" && carro.repasse_texto.trim()) {
    const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;
    return { texto: garantirDisclaimers(garantirCodigo(semRodapesProspeccao(carro.repasse_texto), carro.id)), capaUrl };
  }

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

  // FIPE (valor_fipe do cadastro > parallelum). A "Média da Web" é derivada da
  // FIPE (+1%) dentro do gerarTextoRepasse — não busca mais preço na web.
  const fipe = await resolverFipe(carro, versaoRica);

  // Cidade com UF ("São José do Rio Preto-SP") — o 📍 do anúncio sai completo
  const cidadeUf = cfg?.cidade
    ? [String(cfg.cidade).trim(), String(cfg.estado ?? "").trim()].filter(Boolean).join("-")
    : null;
  const texto = garantirCodigo(gerarTextoRepasse(carro, fipe, null, "repasse", cidadeUf), carro.id);
  const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return { texto, capaUrl };
}
