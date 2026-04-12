import { supabaseAdmin } from "./supabase-admin";

/**
 * Flash: Lógica de Busca de Vendedor para o Agente de IA
 * Busca os dados do veículo e do vendedor responsável para transbordo.
 */
export async function buscarDadosTransbordo(veiculoId: string) {
  const { data, error } = await supabaseAdmin
    .from('veiculos')
    .select(`
      marca, modelo,
      vendedores:vendedor_responsavel_id (
        nome,
        whatsapp
      )
    `)
    .eq('id', veiculoId)
    .single();

  if (error || !data || !data.vendedores) return null;

  // Supabase join returns an object or array depending on foreign key
  const v = Array.isArray(data.vendedores) ? data.vendedores[0] : data.vendedores;

  if (!v || !v.whatsapp) return null;

  return {
    carro: `${data.marca} ${data.modelo}`,
    vendedor_nome: v.nome,
    vendedor_wa: v.whatsapp
  };
}

/**
 * Flash: Função para buscar quem perdeu a compra (Leads Orfãos)
 * Retorna os leads interessados no veículo que acabou de ser vendido.
 */
export async function buscarLeadsOrfaos(veiculoId: string) {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('wa_id, nome')
    .eq('veiculo_id', veiculoId)
    .in('status', ['MORNO', 'QUENTE']); // Só quem tinha interesse real

  return data || [];
}

/**
 * Flash: Gera um relatório executivo do pátio em tempo real para o WhatsApp do Admin
 */
export async function gerarRelatorioPista(nomeEmpresa = "nossa loja", nomeAgente = "IA") {
  // 1. Busca dados de estoque
  const { data: statsVeiculos } = await supabaseAdmin
    .from('veiculos')
    .select('preco_sugerido')
    .eq('status_venda', 'DISPONIVEL');

  const totalEstoque = statsVeiculos?.reduce((acc, curr) => acc + (curr.preco_sugerido || 0), 0) || 0;
  const numCarros = statsVeiculos?.length || 0;

  // 2. Busca leads quentes
  const { count: quentes } = await supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'QUENTE');

  // 3. Busca o carro mais procurado (Baseado no vínculo com leads)
  const { data: popular } = await supabaseAdmin
    .from('leads')
    .select('veiculo_id, veiculos(marca, modelo)')
    .not('veiculo_id', 'is', null);
  
  const counts: Record<string, { count: number, name: string }> = {};
  popular?.forEach((p: any) => {
    if (p.veiculos) {
        const id = p.veiculo_id;
        const name = `${p.veiculos.marca} ${p.veiculos.modelo}`;
        if (!counts[id]) counts[id] = { count: 0, name };
        counts[id].count++;
    }
  });
  
  const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
  const carroDaSemana = sorted[0]?.name || "Nenhum no momento";

  const faturamentoFormatado = new Intl.NumberFormat('pt-BR', { 
    style: 'currency', 
    currency: 'BRL',
    maximumFractionDigits: 0 
  }).format(totalEstoque);

  return `⚡ *${nomeEmpresa.toUpperCase()} - STATUS DO PÁTIO* ⚡\n\n` +
         `🚗 *ESTOQUE:* ${numCarros} máquinas (${faturamentoFormatado})\n` +
         `🔥 *LEADS QUENTES:* ${quentes || 0} aguardando fechamento!\n` +
         `👀 *DESTAQUE:* A ${carroDaSemana} é a mais procurada.\n\n` +
         `💡 *DICA DO ${nomeAgente.toUpperCase()} (IA):* O pátio está aquecido! Não esqueça de conferir os leads que estão sem resposta há mais de 4h. Bora vender! ☕️`;
}

