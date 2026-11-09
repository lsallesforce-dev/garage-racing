-- 076: esconder conversas antigas do chat sem apagar nada.
--
-- Pedido da Carmatti (09/11/2026): "apagar todas as mensagens do dia 30/09 pra
-- trás". Apagar seria 69 mil mensagens sem volta (o backup do Supabase só
-- restaura o projeto inteiro). Decisão do Lucas: esconder.
--
-- O chat não lista lead com updated_at antes desta data. Cliente que escreve de
-- novo sobe o updated_at (upsert do passo 3 do process-whatsapp) e volta pra
-- lista sozinho. A IA continua lembrando do histórico. Null = mostra tudo.

alter table public.config_garage add column if not exists chat_oculta_ate timestamptz;

comment on column public.config_garage.chat_oculta_ate is
  'Chat esconde leads sem atividade (updated_at) antes desta data. Nada é apagado; cliente que escreve de novo volta pra lista.';
