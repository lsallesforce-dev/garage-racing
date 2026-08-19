-- 051_endereco_convite.sql
--
-- Convite de visita determinístico. Quando a IA manda o endereço da loja, o
-- pipeline emenda duas bolhas fixas: o convite ("quando posso te aguardar") e
-- por quem procurar na chegada.
--
-- Era instrução de prompt (config_garage.instrucoes_adicionais da Carmatti) e
-- por isso saía quando a IA lembrava. Pedido do gerente da Carmatti em 19/08:
-- tem que sair SEMPRE, e em bolhas separadas.
--
-- Default false: liga por tenant, não muda o comportamento de quem não pediu.

alter table config_garage
  add column if not exists endereco_convite_ativo boolean not null default false;

comment on column config_garage.endereco_convite_ativo is
  'Emenda duas bolhas (convite de visita + por quem procurar) logo depois de a resposta da IA conter o endereço da loja.';

-- Carmatti Veículos — quem pediu a mudança.
update config_garage
   set endereco_convite_ativo = true
 where user_id = '6fe4f42b-4bff-48d9-93e6-27a5607cd844';
