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
    const result = await getClient().set(key, 1, { nx: true, ex: 3600 });
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

// ─── Ping (para Health Check) ─────────────────────────────────────────────────
export async function redisPing(): Promise<string> {
  return getClient().ping();
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
