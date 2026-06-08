# db/ — Schema do módulo de Prospecção B2B

SQL do **módulo de prospecção B2B** do AutoZap (agente que prospecta revendas no
WhatsApp para assinarem o AutoZap). É **diferente** do agente de vendas de carros
já existente no projeto.

## ⚠️ Ainda NÃO aplicado

O arquivo [`prospeccao.sql`](./prospeccao.sql) **não foi rodado no banco**. Este
projeto não usa migrations locais (não há pasta `supabase/`) nem tipos gerados —
o schema é aplicado direto no Supabase remoto.

## Como aplicar

1. Abra o **Supabase Dashboard** do projeto AutoZap.
2. Vá em **SQL Editor** → **New query**.
3. Cole todo o conteúdo de `prospeccao.sql`.
4. Clique em **Run**.

O script é idempotente (`create table if not exists`, índices `if not exists`,
e `insert ... on conflict do nothing` para a linha de config), então pode ser
rodado novamente sem efeitos colaterais.

Os tipos TypeScript correspondentes estão em
[`../lib/prospeccao-types.ts`](../lib/prospeccao-types.ts) e devem ser mantidos
em sincronia manualmente caso o schema mude.

## Segurança / RLS

As tabelas (`prospects`, `prospect_mensagens`, `prospeccao_config`,
`prospeccao_stats`) são do **sistema** (do dono do AutoZap), **não de tenants**.
RLS é habilitado e **nenhuma policy pública é criada** — com RLS ligado e sem
policy, o padrão é negar tudo. O acesso acontece só via **service role**
(`lib/supabase-admin.ts`, que ignora RLS) através de endpoints protegidos por
header `x-admin-secret`.

## Convenção de `dias_semana`

A coluna `prospeccao_config.dias_semana` (`int[]`) usa o padrão **ISO-8601**:

| Valor | Dia      |
|:-----:|----------|
| 1     | Segunda  |
| 2     | Terça    |
| 3     | Quarta   |
| 4     | Quinta   |
| 5     | Sexta    |
| 6     | Sábado   |
| 7     | Domingo  |

Padrão da campanha: `{1,2,3,4,5}` (segunda a sexta — horário comercial).
