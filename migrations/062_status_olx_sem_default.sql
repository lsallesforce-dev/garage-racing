-- 062 — status_olx deixa de nascer "pendente".
--
-- Por que existe: a coluna tinha DEFAULT 'pendente', então TODO carro
-- cadastrado já nascia "pendente" na OLX sem nunca ter ido pra lá. A tela de
-- Marketing contava "pendente" como publicado e acendia a bolinha verde do OLX
-- em todos os carros. Medido 24/09/2026: APROVE com 39 carros "pendente" e só 1
-- anúncio real (olx_ad_id); Carmatti com 32 "pendente" sem nem ter OLX
-- conectado.
--
-- "pendente" continua válido quando vem da OLX de verdade (/api/olx/status mapeia
-- o "pending" do portal) — aí o carro TEM olx_ad_id. Só o lixo do default sai.
--
-- Reverter: alter table veiculos alter column status_olx set default 'pendente';
-- (os NULLs limpos aqui não precisam voltar — nunca significaram nada.)

alter table veiculos alter column status_olx drop default;

update veiculos
   set status_olx = null
 where status_olx = 'pendente'
   and olx_ad_id is null;
