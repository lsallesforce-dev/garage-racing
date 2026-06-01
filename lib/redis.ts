// lib/redis.ts
//
// Singleton do cliente Upstash Redis — Fase 2 Hardening
//
// Padrão idêntico ao supabase-admin.ts para consistência na codebase.
// Nunca importe o cliente diretamente — use os helpers exportados abaixo.
//
// Namespacing Multi-Tenant:
// ─────────────────────────────────────────────────────────────
//   dedup:{tenantUserId}:{messageId}    TTL: 3600s (1h)
//   history:{tenantUserId}:{leadId}     TTL: 1800s (30min)
//   vitrine:slug:{slug}                TTL: 86400s (24h) — usado pelo middleware
//
// Chaves incluem o tenantUserId como prefixo para garantir isolamento
// completo entre garagens diferentes — mesmo que messageId ou leadId
// sejam UUIDs globalmente únicos, o namespace explícito evita colisões
// em casos de migração ou seed de dados.
//
// Política de falha: FAIL-OPEN
//   Todos os métodos capturam erros e nunca deixam o fluxo principal
//   do lead quebrar. O Redis é cache/otimização — não é critical path.

import { Redis } from "@upstash/redis";

// ─── Lazy Singleton ───────────────────────────────────────────────────────────
let _client: Redis | null = null;

function getClient(): Redis {
  if (!_client) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error(
        "Upstash Redis não configurado. " +
          "Defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no .env.local"
      );
    }

    _client = new Redis({ url, token });
  }
  return _client;
}

// ─── Deduplicação Atômica ─────────────────────────────────────────────────────
//
// Usa SET NX EX — operação atômica do Redis que:
//   - Cria a chave com TTL se ela NÃO existir → retorna "OK"
//   - Não faz nada se a chave JÁ existir → retorna null
//
// Isso garante que em ambientes multi-instância da Vercel apenas a
// primera instância que processar cheque retorna false (não duplicado).
// Qualquer instância subsequente recebe true (duplicado).
//
export async function isDuplicateMessage(
  tenantUserId: string,
  messageId: string
): Promise<boolean> {
  try {
    const key = `dedup:${tenantUserId}:${messageId}`;
    // "OK" = chave era nova = não é duplicado (retorna false)
    // null  = chave já existia = é duplicado (retorna true)
    // TTL de 300s (5min): cobre retries da Meta (até 5min) e re-entregas CTWA
    // com LID que podem chegar com messageIds diferentes.
    const result = await getClient().set(key, 1, { nx: true, ex: 300 });
    return result === null;
  } catch (e) {
    // Fail-open: prefere processar do que bloquear silenciosamente
    console.warn("⚠️ [Redis] isDuplicateMessage falhou — mensagem será processada:", e);
    return false;
  }
}

// ─── Cache de Histórico de Conversa ──────────────────────────────────────────
//
// Armazena o array de histórico de mensagens de um lead no Redis.
// O Upstash SDK serializa/deserializa JSON automaticamente.
// TTL de 30min: cobre o gap típico entre mensagens de um mesmo lead ativo.
//
export async function cacheHistory(
  tenantUserId: string,
  leadId: string,
  history: Array<{ role: string; parts: Array<{ text: string }> }>
): Promise<void> {
  try {
    const key = `history:${tenantUserId}:${leadId}`;
    await getClient().set(key, history, { ex: 1800 });
  } catch (e) {
    console.warn("⚠️ [Redis] cacheHistory falhou (non-fatal):", e);
  }
}

// ─── Recuperação do Cache de Histórico ───────────────────────────────────────
//
// Retorna null em caso de cache miss ou erro — o chamador deve
// fazer o fallback para Supabase.
//
export async function getCachedHistory(
  tenantUserId: string,
  leadId: string
): Promise<Array<{ role: string; parts: Array<{ text: string }> }> | null> {
  try {
    const key = `history:${tenantUserId}:${leadId}`;
    const cached = await getClient().get<
      Array<{ role: string; parts: Array<{ text: string }> }>
    >(key);
    return cached ?? null;
  } catch (e) {
    console.warn("⚠️ [Redis] getCachedHistory falhou (non-fatal):", e);
    return null;
  }
}

// ─── Invalidação do Cache de Histórico ───────────────────────────────────────
//
// Chamado após salvar a resposta do agente no Supabase (step 13).
// Garante que a próxima mensagem do lead busque histórico atualizado.
//
export async function invalidateHistory(
  tenantUserId: string,
  leadId: string
): Promise<void> {
  try {
    const key = `history:${tenantUserId}:${leadId}`;
    await getClient().del(key);
  } catch (e) {
    console.warn("⚠️ [Redis] invalidateHistory falhou (non-fatal):", e);
  }
}

// ─── Append Incremental de Histórico ─────────────────────────────────────────
//
// Alternativa à invalidação: appenda as novas mensagens (user + agent) ao cache
// existente, re-aplica o limite inteligente (2 primeiras + 13 mais recentes)
// e re-cacheia com TTL renovado — sem forçar round-trip ao Supabase.
//
// Se não houver cache (lead inativo > 30min), falha silenciosamente e o próximo
// acesso reconstrói do Supabase normalmente.
//
// Restrição mantida: max 15 msgs = first2 (âncora de contexto) + last13 (recente).
//
export async function appendHistory(
  tenantUserId: string,
  leadId: string,
  newMessages: Array<{ role: string; parts: Array<{ text: string }> }>
): Promise<void> {
  try {
    const key = `history:${tenantUserId}:${leadId}`;
    const client = getClient();
    const current = await client.get<Array<{ role: string; parts: Array<{ text: string }> }>>(key);

    // Cache expirou ou nunca existiu — próxima mensagem reconstruirá do Supabase
    if (!current || !Array.isArray(current)) return;

    const appended = [...current, ...newMessages];

    // Re-aplica restrição: first2 (âncora) + last13 (recente), sem sobreposição
    let trimmed: typeof appended;
    if (appended.length <= 15) {
      trimmed = appended;
    } else {
      const last13StartIndex = appended.length - 13;
      const first2 = appended.slice(0, Math.min(2, last13StartIndex));
      const last13 = appended.slice(-13);
      trimmed = [...first2, ...last13];
    }

    await client.set(key, trimmed, { ex: 1800 });
  } catch (e) {
    // Fail gracefully: invalida o cache para que o próximo acesso reconstrua do Supabase
    console.warn("⚠️ [Redis] appendHistory falhou — invalidando cache (non-fatal):", e);
    try {
      await getClient().del(`history:${tenantUserId}:${leadId}`);
    } catch {}
  }
}

// ─── Debounce de Imagens do Cliente ──────────────────────────────────────────
//
// Quando um cliente envia múltiplas fotos de uma vez (ex: 4 fotos do carro),
// o WhatsApp envia 4 webhooks separados. Sem debounce, cada webhook dispara
// o pipeline completo: busca de veículo + envio de fotos do estoque + link.
//
// Esta função usa SET NX EX (atômico) com TTL de 3 segundos:
//   - Primeira foto da rajada → retorna true (processa normalmente)
//   - Fotos subsequentes dentro de 3s → retorna false (ignora)
//
// A janela de 3s é curta o suficiente para não bloquear uma foto
// enviada intencionalmente minutos depois, mas longa o suficiente
// para agrupar a rajada típica do WhatsApp (100-500ms entre fotos).
//
export async function debounceClientImages(
  tenantUserId: string,
  phone: string
): Promise<boolean> {
  try {
    const key = `imgdebounce:${tenantUserId}:${phone}`;
    const result = await getClient().set(key, 1, { nx: true, ex: 10 });
    return result !== null; // "OK" = primeira foto (processa), null = foto duplicada (ignora)
  } catch (e) {
    console.warn("⚠️ [Redis] debounceClientImages falhou — imagem será processada (fail-open):", e);
    return true;
  }
}

// ─── Debounce de Primeiro Contato (Anti-Saudação Dupla CTWA) ─────────────────
//
// Em Click-to-WhatsApp (CTWA) com LID, a Meta pode entregar o mesmo lead
// duas vezes com messageIds DIFERENTES:
//   1ª entrega: messageId temporário (LID) com adReferral completo
//   2ª entrega: messageId real (número do cliente) sem adReferral
//
// O dedup por messageId NÃO filtra porque são IDs distintos.
// Este guard usa SET NX EX no par (tenant + phone) com TTL de 60s:
//   - Primeira mensagem do phone → retorna true (processa)
//   - Segunda mensagem do mesmo phone em <60s → retorna false (ignora)
//
// Janela de 60s: longa o suficiente para cobrir re-entregas CTWA
// (geralmente <10s), curta o suficiente para não bloquear mensagens
// legítimas subsequentes do mesmo cliente.
//
export async function debounceFirstContact(
  tenantUserId: string,
  phone: string
): Promise<boolean> {
  try {
    const key = `firstcontact:${tenantUserId}:${phone}`;
    const result = await getClient().set(key, 1, { nx: true, ex: 60 });
    return result !== null; // "OK" = primeiro contato (processa), null = re-entrega (ignora)
  } catch (e) {
    console.warn("⚠️ [Redis] debounceFirstContact falhou — mensagem será processada (fail-open):", e);
    return true;
  }
}


// ─── Stand-by de Troca de Veículo ────────────────────────────────────────────
//
// Marcador persistente (TTL 48h) que indica que o atendimento de um lead
// foi transferido ao gerente por conta de uma negociação de troca.
// Quando ativo, o agente responde com mensagem de redirecionamento ao invés de silêncio.
//
// Chave: troca_standby:{tenantUserId}:{leadId}
//
export async function setTrocaStandby(
  tenantUserId: string,
  leadId: string
): Promise<void> {
  try {
    await getClient().set(`troca_standby:${tenantUserId}:${leadId}`, 1, { ex: 172800 }); // 48h
  } catch (e) {
    console.warn("⚠️ [Redis] setTrocaStandby falhou (non-fatal):", e);
  }
}

export async function isTrocaStandby(
  tenantUserId: string,
  leadId: string
): Promise<boolean> {
  try {
    const val = await getClient().get(`troca_standby:${tenantUserId}:${leadId}`);
    return val !== null;
  } catch (e) {
    console.warn("⚠️ [Redis] isTrocaStandby falhou (fail-open):", e);
    return false;
  }
}

// Limpa o flag de handoff após enviar a resposta de segurança UMA vez —
// evita repetir a mesma mensagem a cada mensagem do cliente durante o stand-by.
export async function clearTrocaStandby(
  tenantUserId: string,
  leadId: string
): Promise<void> {
  try {
    await getClient().del(`troca_standby:${tenantUserId}:${leadId}`);
  } catch (e) {
    console.warn("⚠️ [Redis] clearTrocaStandby falhou (non-fatal):", e);
  }
}

// ─── Lock por Lead (Anti-Processamento Concorrente) ───────────────────────────
//
// Garante que apenas uma instância da Vercel processa cada lead por vez.
// SET NX EX 30: adquire se não existe (retorna "OK"), falha se já existe (retorna null).
// TTL de 30s: auto-expira se o processo travar antes do releaseLeadLock — sem deadlock.
// Fail-open: se o Redis estiver offline, libera o processamento normalmente.
//
// Chave: processing:{tenantUserId}:{leadId}
//
export async function acquireLeadLock(
  tenantUserId: string,
  leadId: string
): Promise<boolean> {
  try {
    const key = `processing:${tenantUserId}:${leadId}`;
    const result = await getClient().set(key, 1, { nx: true, ex: 30 });
    return result !== null; // "OK" = lock adquirido, null = já processando
  } catch (e) {
    console.warn("⚠️ [Redis] acquireLeadLock falhou — processando sem lock (fail-open):", e);
    return true;
  }
}

export async function releaseLeadLock(
  tenantUserId: string,
  leadId: string
): Promise<void> {
  try {
    const key = `processing:${tenantUserId}:${leadId}`;
    await getClient().del(key);
  } catch (e) {
    console.warn("⚠️ [Redis] releaseLeadLock falhou (non-fatal):", e);
  }
}

// ─── Ping (para Health Check) ─────────────────────────────────────────────────
export async function redisPing(): Promise<string> {
  return getClient().ping();
}

// ─── Rate Limiter (Sliding Window via INCR + EXPIRE) ─────────────────────────
//
// Usa INCR atômico do Redis. Na primeira chamada da janela, seta o TTL.
// Retorna { allowed: true } se abaixo do limite, { allowed: false } se excedeu.
// Fail-open: se o Redis estiver offline, permite a requisição.
//
// Uso:
//   const rl = await rateLimit(`analyze:${userId}`, 10, 60);
//   if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
//
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: { increment?: boolean } = {}
): Promise<{ allowed: boolean; remaining: number }> {
  // increment: false → só CONSULTA o contador atual sem incrementar
  // (útil para checar se um IP está bloqueado antes de fazer trabalho que pode falhar)
  const { increment = true } = options;
  try {
    const client = getClient();
    const redisKey = `rl:${key}`;
    let count: number;
    if (increment) {
      count = await client.incr(redisKey);
      if (count === 1) {
        // Primeira requisição da janela — define o TTL
        await client.expire(redisKey, windowSeconds);
      }
    } else {
      const current = await client.get<string | number>(redisKey);
      count = current ? Number(current) : 0;
    }
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, remaining };
  } catch (e) {
    console.warn("⚠️ [Redis] rateLimit falhou — requisição permitida (fail-open):", e);
    return { allowed: true, remaining: 0 };
  }
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────
//
// Padrão: CLOSED (normal) → OPEN (falha rápida) → CLOSED (auto-recuperação)
//
// Lógica:
//   - Cada falha incrementa `circuit:{key}:failures` (TTL 60s)
//   - Ao atingir o threshold → seta `circuit:{key}:open` (TTL halfOpenMs/1000)
//   - Antes de chamar o serviço → verifica se `circuit:{key}:open` existe
//   - Sucesso → deleta ambas as chaves
//
// Uso:
//   if (await circuitIsOpen("gemini")) throw new Error("circuit open");
//   try { ... } catch { await circuitRecordFailure("gemini"); throw; }
//   await circuitRecordSuccess("gemini");
//
const CIRCUIT_THRESHOLD = 5;          // falhas em 60s para abrir
const CIRCUIT_FAILURE_TTL = 60;       // janela de contagem (segundos)
const CIRCUIT_OPEN_TTL = 30;          // tempo aberto antes de tentar novamente (segundos)

export async function circuitIsOpen(key: string): Promise<boolean> {
  try {
    const val = await getClient().get(`circuit:${key}:open`);
    return val !== null;
  } catch {
    return false; // fail-open: se Redis offline, deixa o serviço tentar
  }
}

export async function circuitRecordFailure(key: string): Promise<void> {
  try {
    const client = getClient();
    const count = await client.incr(`circuit:${key}:failures`);
    if (count === 1) await client.expire(`circuit:${key}:failures`, CIRCUIT_FAILURE_TTL);
    if (count >= CIRCUIT_THRESHOLD) {
      await client.set(`circuit:${key}:open`, 1, { ex: CIRCUIT_OPEN_TTL });
      console.warn(`⚡ Circuit breaker ABERTO para "${key}" (${count} falhas em ${CIRCUIT_FAILURE_TTL}s)`);
    }
  } catch (e) {
    console.warn("⚠️ [Redis] circuitRecordFailure falhou (non-fatal):", e);
  }
}

export async function circuitRecordSuccess(key: string): Promise<void> {
  try {
    const client = getClient();
    await client.del(`circuit:${key}:failures`);
    await client.del(`circuit:${key}:open`);
  } catch (e) {
    console.warn("⚠️ [Redis] circuitRecordSuccess falhou (non-fatal):", e);
  }
}

// ─── Guard de Idempotência para Cron Jobs ────────────────────────────────────
//
// Usa SET NX: retorna true se esta é a primeira execução para a chave dada,
// false se já foi executado (chave já existia). Fail-open: se o Redis estiver
// offline, permite a execução para não bloquear o cron silenciosamente.
//
// Uso:
//   const primeiraVez = await cronGuard("relatorio:uid123:2025-W18", 8 * 86400);
//   if (!primeiraVez) { console.log("já enviado — skip"); continue; }
//
export async function cronGuard(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const result = await getClient().set(`cron:${key}`, 1, { nx: true, ex: ttlSeconds });
    return result !== null; // null = chave já existia = já rodou
  } catch (e) {
    console.warn("⚠️ [Redis] cronGuard falhou — cron permitido (fail-open):", e);
    return true;
  }
}

// ─── Cache de Slug da Vitrine (usado pelo Middleware Multi-Tenant) ────────────
//
// O middleware.ts roda no Edge Runtime e valida slugs via Redis REST API.
// Essas funções são chamadas no contexto Node.js (Server Actions / API Routes)
// para manter o cache sincronizado com o banco.
//
// Ciclo de vida:
//   1. Admin cadastra/atualiza vitrine_slug → chama `cacheVitrineSlug`
//   2. Middleware valida `vitrine:slug:{slug}` existe no Redis
//   3. Admin desativa loja → chama `invalidateVitrineSlug`
//   4. Middleware redireciona para /loja-nao-encontrada
//
// TTL de 24h: muito maior que slugs de garagem são atualizados na prática.
// A invalidação manual garante consistência sem depender do TTL.
//
export async function cacheVitrineSlug(
  slug: string,
  userId: string
): Promise<void> {
  try {
    const key = `vitrine:slug:${slug}`;
    // Valor é o userId para facilitar lookups futuros sem ir ao Supabase
    await getClient().set(key, userId, { ex: 86400 }); // 24h
    console.log(`✅ [Redis] Slug cacheado: ${key} → ${userId}`);
  } catch (e) {
    console.warn("⚠️ [Redis] cacheVitrineSlug falhou (non-fatal):", e);
  }
}

export async function invalidateVitrineSlug(slug: string): Promise<void> {
  try {
    const key = `vitrine:slug:${slug}`;
    await getClient().del(key);
    console.log(`🗑️ [Redis] Slug invalidado: ${key}`);
  } catch (e) {
    console.warn("⚠️ [Redis] invalidateVitrineSlug falhou (non-fatal):", e);
  }
}

// Retorna o userId associado ao slug, ou null se não estiver no cache.
// Útil para componentes que precisam do userId sem ir ao Supabase.
export async function getVitrineSlugOwner(
  slug: string
): Promise<string | null> {
  try {
    const key = `vitrine:slug:${slug}`;
    return await getClient().get<string>(key);
  } catch (e) {
    console.warn("⚠️ [Redis] getVitrineSlugOwner falhou (non-fatal):", e);
    return null;
  }
}
