// lib/prospeccao-historico.ts
// =============================================================================
// Gravação das bolhas do agente com ORDEM preservada
// =============================================================================
// Quatro lugares gravavam as bolhas de uma resposta com um insert em lote, sem
// `created_at` — o Postgres carimbava now() e as N linhas saíam com o MESMO
// timestamp ao milissegundo. Empate é ordem indefinida: qualquer
// `.order("created_at")` devolve as bolhas embaralhadas.
//
// Não é problema de vitrine. Isso quebra três coisas de uma vez:
//   1. o Inbox do admin, que lê a conversa por created_at — foi assim que o
//      Fernando Duarte apareceu recebendo "É a Mari, do AutoZap" ANTES do
//      "Oi, tudo bem?";
//   2. o HISTÓRICO que vai pro Gemini, montado da mesma tabela — o modelo lê as
//      próprias falas fora de ordem e responde em cima de um diálogo que nunca
//      aconteceu;
//   3. qualquer diagnóstico nosso, que é feito lendo essas conversas.
//
// A entrega no WhatsApp sempre esteve certa (o envio é sequencial, com pausa).
// O que estava errado era o registro.
// =============================================================================

/**
 * Converte as bolhas de UMA resposta em linhas de `prospect_mensagens`,
 * carimbando cada uma 1ms depois da anterior pra ordem ficar estável.
 * `base` permite alinhar com o horário real do envio; default = agora.
 */
export function bolhasParaLinhas(
  prospectId: string,
  bolhas: string[],
  remetente: "agente" | "prospect" | "humano" = "agente",
  base: Date = new Date(),
): { prospect_id: string; remetente: string; content: string; created_at: string }[] {
  const t0 = base.getTime();
  return bolhas.map((content, i) => ({
    prospect_id: prospectId,
    remetente,
    content,
    created_at: new Date(t0 + i).toISOString(),
  }));
}
