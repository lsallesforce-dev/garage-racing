// lib/config-garage.ts
//
// FONTE ÚNICA dos campos de `config_garage` lidos pelo pipeline do agente.
//
// Antes de 10/08 existiam CINCO listas diferentes (webhook Avisa, webhook Meta,
// leads/atendimento, cron reprocessar-pendentes, admin replay-lead) e nenhuma
// era igual à outra. Consequências reais em produção:
//
//   · tenant no canal META nunca recebia `modo_repasse` nem
//     `envio_material_completo` → os 45 blocos de MODO REPASSE do prompt e o
//     envio de ficha simplesmente não existiam nesse canal. O MESMO tenant se
//     comportava como dois produtos diferentes dependendo de qual webhook
//     recebeu a mensagem.
//   · `admin/replay-lead` (a ferramenta de debug) reproduzia o lead com um
//     config diferente do de produção — bug de repasse não reproduzia ali.
//   · `reprocessar-pendentes` não carregava `cidade` → a CIDADE DA LOJA sumia
//     do prompt no reprocessamento.
//
// ⚠️ Campo novo aqui exige que a coluna EXISTA no banco. Coluna inexistente num
// SELECT faz o PostgREST devolver 42703; como boa parte do código descarta o
// `error`, o webhook responde 200 e não grava nada — o agente fica mudo sem
// nenhum sinal (incidente Carmatti, 29-30/07). Rodar a migration ANTES do
// deploy, sempre.

// ⚠️ TEM que ser um LITERAL de string única, não um array com `.join(", ")`.
// O supabase-js infere o tipo da linha a partir do tipo LITERAL do argumento de
// `.select()`. Com uma string montada em runtime a inferência morre e a linha
// vira `GenericStringError` — todo acesso a campo (`cfg.plano_ativo`) passa a
// ser erro de tipo, e como o projeto roda com `ignoreBuildErrors: true` isso
// não quebraria o build: só apagaria a checagem justamente no caminho quente.
// Por isso os campos vão em uma linha só, agrupados na tabela do comentário:
//
//   identidade   nome_empresa, nome_fantasia, nome_agente, endereco,
//                endereco_complemento, cidade, estado, telefone_loja,
//                horario_funcionamento
//   telefones    whatsapp, whatsapp_agente, whatsapp_financeiro,
//                whatsapp_posvenda
//   vitrine      vitrine_slug, dominio_custom
//   canais       webhook_token, avisa_base_url, avisa_token, meta_phone_id,
//                meta_access_token
//   agente       tom_venda, instrucoes_adicionais, oferta_especial,
//                modo_repasse, ia_so_responde_anuncio, agente_pausado,
//                ia_modo_lead_only, envio_material_completo,
//                endereco_convite_ativo, nome_usuario, cargo_usuario
//   voz          voz_habilitada, voz_politica, voz_id, voz_max_chars
//   plano        plano_ativo, trial_ends_at, plano_vence_em
export const CONFIG_GARAGE_SELECT =
  "user_id, nome_empresa, nome_fantasia, nome_agente, endereco, endereco_complemento, cidade, estado, telefone_loja, horario_funcionamento, whatsapp, whatsapp_agente, whatsapp_financeiro, whatsapp_posvenda, vitrine_slug, dominio_custom, webhook_token, avisa_base_url, avisa_token, meta_phone_id, meta_access_token, tom_venda, instrucoes_adicionais, oferta_especial, modo_repasse, ia_so_responde_anuncio, agente_pausado, ia_modo_lead_only, envio_material_completo, endereco_convite_ativo, nome_usuario, cargo_usuario, voz_habilitada, voz_politica, voz_id, voz_max_chars, plano_ativo, trial_ends_at, plano_vence_em, handoff_sla_horas, handoff_ia_retoma, alertas_whatsapp_ativo" as const;
