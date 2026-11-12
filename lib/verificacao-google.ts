// lib/verificacao-google.ts
// Arquivos de verificação do Google Search Console por loja (método "Arquivo
// HTML"): o Google pede pra servir /google<código>.html no domínio próprio.
//
// Lista FECHADA de propósito: responder qualquer google*.html deixaria um
// estranho provar posse do domínio da loja na conta Search Console dele (ver
// dados, pedir remoção de páginas). O Google manda NÃO remover depois de
// verificado — então isso fica no código, não em vitrine_tema (salvar a tela
// de Configurações já apagou campo de vitrine_tema antes, ver LeMotors).
//
// Pra adicionar: slug da vitrine → nome do arquivo que o Search Console mostra.

const ARQUIVOS: Record<string, string[]> = {
  aprovemultimarcas: ["google2edfa08b65e269ca.html"], // 12/11/2026, Lucas
};

export const ARQUIVO_GOOGLE_RE = /^\/(google[0-9a-f]{16}\.html)$/;

export function arquivoGoogleValido(slug: string, arquivo: string): boolean {
  return (ARQUIVOS[slug] ?? []).includes(arquivo);
}
