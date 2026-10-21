-- 070: simulação manual pela página /financiamento (além da IA no WhatsApp).
-- Simulação do painel não tem lead: nome/celular/carro ficam na própria linha.

alter table financiamento_simulacoes add column if not exists origem text not null default 'ia';  -- ia | painel
alter table financiamento_simulacoes add column if not exists cliente_nome text;
alter table financiamento_simulacoes add column if not exists celular text;
alter table financiamento_simulacoes add column if not exists veiculo_desc text;
alter table financiamento_simulacoes add column if not exists criado_por uuid;
