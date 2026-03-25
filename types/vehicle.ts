export interface Vehicle {
  id: string;
  marca: string;
  modelo: string;
  versao?: string;
  ano_fabricacao?: number;
  ano_modelo?: number;
  ano?: number; // Alias para ano_modelo, comum em buscas
  cor?: string;
  quilometragem_estimada?: number;
  combustivel?: string;
  preco_sugerido: number;
  opcionais?: string[];
  pontos_fortes_venda?: string[];
  detalhes_inspecao?: string;
  transcricao_vendedor?: string;
  tags_busca?: string;
  video_url?: string;
  embedding?: number[];
  created_at?: string;
  vendedor_id: string;
  condicao?: string;
  local?: string;
  parcelas?: string;
  vendedor_responsavel_id?: string;
  vendedor_nome?: string;
  status_venda?: 'DISPONIVEL' | 'VENDIDO';
  roteiro_pitch?: string;
  capa_marketing_url?: string;
  segundo_dono?: boolean;
  final_placa?: string;
  tipo_banco?: string;
  motor?: string;
  estado_pneus?: string;
  categoria?: string;
}
