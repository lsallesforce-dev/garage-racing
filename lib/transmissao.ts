// lib/transmissao.ts
//
// Núcleo da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO — não
// confundir com a prospecção B2B da Mari em lib/process-prospeccao.ts).
// Lista de transmissão pessoal: anúncio de carro (texto de repasse SEM o
// wa.me do agente) disparado 1-a-1 pros contatos das listas A/B/C, numa
// instância Avisa dedicada, com cadência anti-ban (ver cron/transmissao-envios).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { buscarMediaWeb, resolverFipe, gerarTextoRepasse } from "@/lib/repasse";

// ── Saudação personalizada por contato ────────────────────────────────────────
// Aplicada NO ENVIO (não no texto congelado da campanha): cada mensagem sai
// única — cara de mensagem pessoal E quebra o fingerprint de payload idêntico
// em massa (lição do soft-ban 463 do chip da Mari).
const SAUDACOES: ((nome: string) => string)[] = [
  (n) => `Olá ${n}, tudo bem?`,
  (n) => `Oi ${n}! Olha essa oportunidade:`,
  (n) => `${n}, tudo certo? Chegou essa aqui:`,
  (n) => `Opa ${n}, dá uma olhada nessa:`,
  (n) => `${n}, olha o que acabou de chegar:`,
  (n) => `Oi ${n}, tudo bom? Separei essa pra você:`,
];

/** Primeiro nome, capitalizado ("MARCOS silva" → "Marcos"). */
export function primeiroNome(nome: string): string {
  const p = (nome || "").trim().split(/\s+/)[0] || "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

/** Saudação sorteada + texto da campanha. Sem nome válido, vai só o texto. */
export function montarMensagemEnvio(nomeContato: string, textoCampanha: string): string {
  const nome = primeiroNome(nomeContato);
  if (!nome) return textoCampanha;
  const saudacao = SAUDACOES[Math.floor(Math.random() * SAUDACOES.length)](nome);
  return `${saudacao}\n\n${textoCampanha}`;
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
 * Reusa gerarTextoRepasse com botPhone=null → o bloco "💬 Falar com Vendedor"
 * NÃO entra (lista pessoal, sem direcionamento pro agente). Vitrine FICA
 * (decisão de produto 07/07). Retorna null se o veículo não existir.
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
    .select("vitrine_slug, cidade, estado")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;
  const vitrineUrl = cfg?.vitrine_slug
    ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${cfg.vitrine_slug}`
    : null;

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
  // botPhone=null → sem "Falar com Vendedor". Vitrine mantida.
  const texto = gerarTextoRepasse(carro, fipe, mediaWeb, null, "repasse", vitrineUrl, cidadeUf);
  const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return { texto, capaUrl };
}
