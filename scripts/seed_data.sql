-- seed_data.sql
-- Flash: Script para dar "vida" ao seu Dashboard da Garage Racing
-- Rode isso no editor de SQL do Supabase para ver o efeito WOW imediatamente.

-- 1. Inserir alguns Leads de Exemplo
INSERT INTO leads (wa_id, nome, status, resumo_negociacao, veiculo_id, updated_at)
VALUES 
('5521999998888', 'Fernando Motta', 'QUENTE', 'Interessado na Hilux SW4, pronto para fechar.', (SELECT id FROM veiculos LIMIT 1), NOW() - INTERVAL '5 minutes'),
('5521777776666', 'Juliana Silva', 'MORNO', 'Perguntou sobre financiamento da Renegade.', (SELECT id FROM veiculos OFFSET 2 LIMIT 1), NOW() - INTERVAL '45 minutes'),
('5511555554444', 'Ricardo Alencar', 'FRIO', 'Apenas curioso sobre o estoque de motos.', NULL, NOW() - INTERVAL '2 hours');

-- 2. Inserir algumas Vendas Concluídas (Para o gráfico de faturamento)
INSERT INTO vendas_concluidas (veiculo_id, vendedor_id, valor_venda, data_venda)
VALUES
((SELECT id FROM veiculos LIMIT 1), (SELECT id FROM vendedores LIMIT 1), 245000.00, NOW() - INTERVAL '2 days'),
((SELECT id FROM veiculos OFFSET 1 LIMIT 1), (SELECT id FROM vendedores OFFSET 1 LIMIT 1), 48500.00, NOW() - INTERVAL '10 days');

-- 3. Marcar esses carros como VENDIDOS no estoque real (para não aparecerem na vitrine)
UPDATE veiculos SET status_venda = 'VENDIDO' WHERE id IN (SELECT veiculo_id FROM vendas_concluidas);
