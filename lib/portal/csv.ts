// Quoting de CSV — compartilhado pelos feeds públicos.
//
// Estava duplicado como `cell()` local em app/carros/page-feed.csv. O feed de
// catálogo da Meta (vitrine/[tenant]/feed.csv) carrega descrição e endereço,
// campos com vírgula e aspas de verdade — quoting errado ali desloca coluna e
// a Meta rejeita a linha inteira.

/** Envolve em aspas e escapa as internas (RFC 4180). */
export const cell = (s: string | number | null | undefined): string =>
  `"${String(s ?? "").replace(/"/g, '""')}"`;

/** Monta uma linha de CSV a partir das colunas já na ordem do cabeçalho. */
export const csvLinha = (valores: (string | number | null | undefined)[]): string =>
  valores.map(cell).join(",");
