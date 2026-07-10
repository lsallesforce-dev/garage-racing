-- migrations/023_transmissao_senha.sql
--
-- Senha da página Prospecção, POR TENANT (pedido Marcos Repasse): ao clicar em
-- "Prospecção" na sidebar, abre um modal pedindo senha. A lista de contatos é
-- pessoal do dono e não deve ser aberta por um funcionário com a conta logada.
-- ⚠️ Trava de UX (a senha vai pro client pra validar o modal); os dados seguem
-- protegidos pelo auth do tenant nas rotas /api/transmissao/*. Vazia = sem trava.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS transmissao_senha text;

-- Senha inicial do Marcos Repasse
UPDATE config_garage SET transmissao_senha = 'm@rcos123'
  WHERE user_id = '369dd610-8325-4a6a-a656-f6c93bfca4fb';
