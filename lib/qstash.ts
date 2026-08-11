// Client QStash + URL do worker Railway, num lugar só.
//
// Estava instanciado inline em 3 rotas (marketing/reel, marketing/iniciar,
// leads/devolver-ia) com o mesmo bloco copiado e o mesmo default de URL
// hardcoded. Esta seria a quarta cópia.
//
// Idempotência NÃO é feita por deduplicationId em nenhum dos usos: é sempre uma
// coluna de status marcada ANTES do publish (anti-double-click) mais um guard no
// próprio worker. Manter esse padrão em job novo.

import { Client } from "@upstash/qstash";

export const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

export const WORKER_URL =
  process.env.RAILWAY_WORKER_URL ?? "https://garage-racing-production.up.railway.app";

/** Enfileira um job no worker. `rota` é o path, ex: "/reel", "/decupar". */
export function enfileirarNoWorker(rota: string, body: Record<string, any>, retries = 1) {
  return qstash.publishJSON({ url: `${WORKER_URL}${rota}`, body, retries });
}
