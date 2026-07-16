// lib/admin-eventos.ts
// Timeline de eventos por tenant (tabela admin_eventos, migration 029): avisos de
// cobrança, pagamentos, mudanças de plano, suspensões etc.
//
// Fire-and-forget: NUNCA quebra o caller — erro de banco vira console.warn e a rota
// segue normal. Retorna uma Promise que nunca rejeita, então quem quiser pode dar
// `await` com segurança (recomendado em rotas serverless, pra não perder o insert
// quando a função congela após a resposta).

import { supabaseAdmin } from "@/lib/supabase-admin";

export function logEventoAdmin(
  userId: string,
  tipo: string,
  descricao: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  return Promise.resolve(
    supabaseAdmin.from("admin_eventos").insert({
      user_id: userId,
      tipo,
      descricao,
      meta: meta ?? null,
    }),
  )
    .then(({ error }) => {
      if (error) console.warn(`[admin-eventos] falha ao logar "${tipo}":`, error.message);
    })
    .catch((e) => console.warn(`[admin-eventos] falha ao logar "${tipo}":`, e));
}
