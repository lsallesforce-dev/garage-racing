# AutoZap — Problemas do Agente de Chat (07/04/2026)

## Contexto

Sistema de vendas via WhatsApp com IA (Gemini 2.5-flash). O agente recebe mensagens de clientes, consulta o estoque no banco (Supabase + pgvector), e responde como vendedor humano. Pode enviar fotos e vídeos dos veículos cadastrados.

Stack: Next.js 16, Supabase (PostgreSQL + pgvector), Upstash Redis, Avisa API (WhatsApp), Google Gemini.

---

## Problema 1 — Agente não sabe o preço de carros que estão no banco

**Fluxo observado:**
1. Cliente pergunta "Qual o valor dos dois?" (Corolla Altis 2017 e XEI 2016)
2. Agente responde o preço do Altis corretamente
3. Para o XEI, diz "vou verificar com a equipe"
4. Cliente insiste 3x mais — agente continua dizendo "estou aguardando"

**Causa:** O banco tem `preco_sugerido` para ambos. O problema é conflito de regras no system prompt:
- Regra 9: "ignore completamente as alternativas enquanto o cliente estiver no veículo em negociação"
- Regra de preço: "preço é sagrado, responda imediatamente"

Como o Altis virou `veiculoPrincipal` e o XEI foi para a seção ALTERNATIVAS, a Regra 9 prevaleceu. O agente aprendeu no histórico que "não tem o preço do XEI" e seguiu repetindo isso mesmo com o dado disponível.

**Fix aplicado:** Regra absoluta de preço elevada para a seção de máxima prioridade + instrução de quebra de loop histórico.

**Status:** Parcialmente resolvido. Em novas conversas funciona. Em conversas onde o loop já se instalou no histórico, o LLM ainda segue o padrão.

---

## Problema 2 — Foto do carro errado sendo enviada

**Fluxo observado:**
1. Cliente pergunta sobre Corolla XEI 2016
2. Agente confirma que tem, descreve o carro corretamente
3. Cliente pede foto
4. Sistema envia foto de um **Volkswagen Gol** (carro completamente diferente)

**Em outro teste:**
1. Cliente estava vendo Corolla Altis (marrom)
2. Menciona que viu um prata no anúncio → agente confirma o XEI prata
3. Cliente pede foto
4. Sistema envia foto do Altis (carro anterior)

**Causa raiz:** A lógica de seleção do veículo para foto usava `topVeiculos[0]` como fallback:

```typescript
const veiculoParaFoto =
  (clientePediuFoto && hitsTextuais.length > 0)
    ? hitsTextuais[0]
    : veiculoPrincipal ?? topVeiculos[0] ?? null; // ← fallback perigoso
```

Quando o cliente diz "Tem foto?" sem mencionar o carro pelo nome, não há `hitsTextuais`. O sistema cai em `topVeiculos[0]` que vem de uma busca semântica sobre a frase "Tem foto?" — que pode retornar qualquer carro do estoque.

**Problema secundário:** O `veiculo_id` do lead (que define o `veiculoPrincipal`) nem sempre é atualizado quando o foco muda de carro. Exemplo: cliente diz "tem outro Corolla?" → o agente menciona o XEI, mas se o token de busca não identificou `clientePediuCarroDiferente = true`, o `veiculo_id` permanece apontando para o Altis. Na próxima mensagem "Tem foto?", `veiculoPrincipal` ainda é o Altis.

**Fix aplicado:**
- Removido `topVeiculos[0]` como fallback — foto/vídeo só são enviados se há carro claramente identificado
- Detecção de "outro [modelo]" para forçar troca de `veiculo_id`
- ID do veículo em foco agora aparece explicitamente no contexto do Gemini
- Campo `Foto: Sim/Não` e `Vídeo: Sim/Não` adicionados à ficha de cada carro no contexto

**Status:** Caso do Gol resolvido. Caso de troca de carro dentro do mesmo modelo (Altis → XEI) ainda é frágil.

---

## Problema 3 — Agente diz "não temos foto" quando foto foi enviada

**Fluxo observado:**
1. Sistema envia foto corretamente via WhatsApp
2. Agente responde em texto: "Não temos foto disponível desse, Lucas"

**Causa:** Havia uma flag `fotoEnviada` que controlava o texto do agente. Em alguns casos a flag estava `false` mesmo após envio bem-sucedido (possível race condition ou falha silenciosa no fetch da URL).

**Fix aplicado:** O agente agora **não envia texto nenhum** quando foto ou vídeo é enviado — early return antes de chamar o Gemini. Elimina completamente o descompasso.

**Status:** Resolvido.

---

## Problema 4 — Agente repete "Segue a foto!" / "Segue o vídeo!" em toda conversa

**Comportamento:** A cada foto ou vídeo enviado, o agente mandava uma mensagem de texto junto: "Segue a foto!" — e repetia isso em cada envio de mídia.

**Fix aplicado:** Junto com o fix do Problema 3, o texto foi eliminado. Mídia é enviada em silêncio.

**Status:** Resolvido.

---

## Problema 5 — Agente adicionava o nome do carro na mensagem de vídeo

**Comportamento:** Em vez de "Segue o vídeo!", o agente respondia "Segue o vídeo do Corolla 2017!" — mas já foi resolvido junto ao problema 3/4.

**Status:** Resolvido (junto ao early return de mídia).

---

## Problema Estrutural Central (não resolvido)

O rastreamento do "carro em foco" é frágil porque depende de:

1. **Busca textual** identificar o carro correto na mensagem
2. **Update no banco** (`veiculo_id` do lead) acontecer com sucesso
3. **Próxima mensagem** carregar o `veiculoPrincipal` correto do banco

Qualquer falha nessa cadeia faz o foco mudar para o carro errado. Casos que quebram:

- Cliente muda de carro com linguagem indireta ("mas vi um prata", "e aquele outro?")
- Agente menciona um carro diferente na resposta, mas o sistema não atualizou o `veiculo_id`
- Mensagens ambíguas como "Tem foto?" sem referenciar o carro pelo nome

### Proposta de solução mais robusta

Em vez de inferir o carro em foco pela busca textual de cada mensagem, o agente poderia retornar o ID do carro em foco no JSON de resposta:

```json
{
  "resposta": "O XEI prata está por R$ 85.000.",
  "temperatura": "MORNO",
  "veiculo_id_foco": "06df8fd7-07c8-4df6-a236-5a82f3e21446"
}
```

O sistema salvaria esse ID no banco após cada resposta. Na próxima mensagem, `veiculoPrincipal` seria carregado diretamente desse ID — sem depender de heurísticas de busca textual. O agente tem contexto completo e sabe exatamente de qual carro estava falando.

---

## Arquivos relevantes

- `lib/process-whatsapp.ts` — lógica principal, seleção de mídia, system prompt
- `lib/hybrid-search.ts` — busca textual + semântica, detecção de troca de carro
- `lib/gemini.ts` — geração de embedding e resposta do agente
