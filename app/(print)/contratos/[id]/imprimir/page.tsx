"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, Loader2 } from "lucide-react";
import { numeroExtenso } from "@/lib/numero-extenso";

interface PagamentoItem {
  tipo: "dinheiro" | "pix" | "transferencia" | "financiamento" | "troca";
  valor: number;
  descricao?: string;
  troca_marca?: string;
  troca_modelo?: string;
  troca_ano_fab?: string;
  troca_ano_mod?: string;
  troca_placa?: string;
  troca_renavam?: string;
}

interface DadosContrato {
  vendedor: { nome: string; cnpj: string; endereco: string; cidade: string; estado: string; logo_url?: string };
  comprador: { nome: string; cpf: string; email: string; endereco: string; cidade: string; estado: string; cep: string; telefone: string; apelido?: string };
  veiculo: { marca: string; modelo: string; versao?: string; ano_fab: string; ano_mod: string; placa: string; renavam: string; chassi: string };
  regularidade: { furto: string; multas: string; alienacao: string; outros: string };
  valor_total: number;
  pagamentos: PagamentoItem[];
  observacoes: string;
  cidade_contrato: string;
  data_assinatura: string;
  hora_assinatura: string;
}

function textoDataLonga(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  const meses = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
  return `${parseInt(dia)} de ${meses[parseInt(mes) - 1]} de ${ano}`;
}

function descricaoPagamentos(pagamentos: PagamentoItem[]): string {
  return pagamentos.map(p => {
    const ext = numeroExtenso(p.valor);
    const valorFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(p.valor);
    if (p.tipo === "troca") {
      return `${p.troca_marca} ${p.troca_modelo}, ANO ${p.troca_ano_fab} MODELO ${p.troca_ano_mod}, PLACA ${p.troca_placa}, RENAVAM ${p.troca_renavam}, NO VALOR DE ${valorFmt} (${ext})`;
    }
    const labels: Record<string, string> = { dinheiro: "PAGAMENTO EM DINHEIRO", pix: "PIX", transferencia: "TRANSFERÊNCIA BANCÁRIA", financiamento: "FINANCIAMENTO" };
    const label = labels[p.tipo] ?? p.tipo.toUpperCase();
    return `${label} NO VALOR DE ${valorFmt} (${ext})${p.descricao ? ` - ${p.descricao.toUpperCase()}` : ""}`;
  }).join(" E ");
}

export default function ImprimirContratoPage() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<DadosContrato | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/contratos/${id}`)
      .then(r => r.json())
      .then(c => { setDados(c.dados); setLoading(false); });
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <Loader2 size={24} className="animate-spin text-gray-400" />
    </div>
  );
  if (!dados) return <div className="flex items-center justify-center min-h-screen">Contrato não encontrado.</div>;

  const d = dados;
  const valorTotal = d.valor_total ?? 0;
  const valorExt = numeroExtenso(valorTotal);
  const valorFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valorTotal);
  const textoData = d.data_assinatura ? textoDataLonga(d.data_assinatura) : "";
  const textoPagamento = Array.isArray(d.pagamentos) && d.pagamentos.length > 0
    ? descricaoPagamentos(d.pagamentos)
    : `PAGAMENTO EM DINHEIRO NO VALOR DE ${valorFmt} (${valorExt})`;

  const compradorBloco = [
    d.comprador.nome,
    d.comprador.cpf ? `, inscrito no CPF/CNPJ sob o nº ${d.comprador.cpf}` : "",
    d.comprador.email ? `, Email: ${d.comprador.email.toUpperCase()}` : "",
    d.comprador.endereco ? ` com endereço em ${d.comprador.endereco.toUpperCase()}` : "",
    d.comprador.cidade ? `, ${d.comprador.cidade.toUpperCase()}${d.comprador.estado ? `-${d.comprador.estado.toUpperCase()}` : ""}` : "",
    d.comprador.cep ? `, CEP ${d.comprador.cep}` : "",
    d.comprador.telefone ? `, telefone ${d.comprador.telefone}` : "",
    d.comprador.apelido ? ` (${d.comprador.apelido.toUpperCase()})` : "",
    ".",
  ].join("");

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; background: white; }
          .print-page { padding: 0 !important; }
        }
        @page { size: A4; margin: 18mm 20mm; }
        body { font-family: Arial, Helvetica, sans-serif; }
      `}</style>

      {/* Botão de impressão — some no print */}
      <div className="no-print fixed top-4 right-4 z-50">
        <button onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-3 bg-gray-900 hover:bg-green-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest transition-colors shadow-xl">
          <Printer size={15} /> Imprimir / Salvar PDF
        </button>
      </div>

      {/* Contrato */}
      <div className="print-page bg-white min-h-screen p-8 md:p-12 max-w-4xl mx-auto text-gray-900" style={{ fontSize: "11px", lineHeight: "1.6" }}>

        {/* Logo + Título */}
        <div className="flex items-start justify-between mb-6">
          <div className="w-36">
            {d.vendedor.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.vendedor.logo_url} alt="Logo" style={{ maxHeight: "60px", maxWidth: "140px", objectFit: "contain" }} />
            ) : (
              <div style={{ width: "140px", height: "50px", background: "#f4f4f2", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#999" }}>
                {d.vendedor.nome}
              </div>
            )}
          </div>
          <div className="text-center flex-1 px-4">
            <p style={{ fontWeight: "bold", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Contrato de Compra e Venda de Veículo Semi-Novo
            </p>
          </div>
          <div className="w-36" />
        </div>

        {/* Vendedor */}
        <p style={{ marginBottom: "8px", textAlign: "justify" }}>
          <strong>VENDEDOR:</strong> {d.vendedor.nome.toUpperCase()}{d.vendedor.cnpj ? `, inscrito no CNPJ ${d.vendedor.cnpj}` : ""}{d.vendedor.endereco ? `, com sede à ${d.vendedor.endereco.toUpperCase()}` : ""}{d.vendedor.cidade ? ` na cidade de ${d.vendedor.cidade.toUpperCase()}${d.vendedor.estado ? ` - ${d.vendedor.estado.toUpperCase()}` : ""}` : ""}.
        </p>

        {/* Comprador */}
        <p style={{ marginBottom: "8px", textAlign: "justify" }}>
          <strong>COMPRADOR:</strong> {compradorBloco}
        </p>

        <p style={{ marginBottom: "14px", textAlign: "justify" }}>
          As partes pactuam a venda e compra de veículo automotor, regidos pelas disposições previstas nos artigos 427 a 435 e 475 a 477 do Código Civil Brasileiro, bem como na lei 8078/1990 ou seja, o código de defesa do consumidor, assim, como segue exposto:
        </p>

        {/* Objeto */}
        <p style={{ marginBottom: "14px", textAlign: "justify" }}>
          <strong>OBJETO DO CONTRATO:</strong> Veículo Marca {(d.veiculo.marca || "").toUpperCase()}, {(d.veiculo.modelo || "").toUpperCase()}{d.veiculo.versao ? ` ${d.veiculo.versao.toUpperCase()}` : ""}, ANO {d.veiculo.ano_fab} MODELO {d.veiculo.ano_mod}, PLACA {(d.veiculo.placa || "").toUpperCase()}{d.veiculo.renavam ? `, RENAVAM ${d.veiculo.renavam}` : ""}{d.veiculo.chassi ? `, CHASSI ${d.veiculo.chassi.toUpperCase()}` : ""}.
        </p>

        {/* Situação */}
        <p style={{ fontWeight: "bold", marginBottom: "4px", textTransform: "uppercase" }}>Situação de Regularidade</p>
        <p>Furto: {d.regularidade.furto}</p>
        <p>Multas e Taxas anuais em aberto: {d.regularidade.multas}</p>
        <p>Alienação Fiduciária: {d.regularidade.alienacao}</p>
        <p style={{ marginBottom: "14px" }}>Outros registros impeditivos à circulação do veículo: {d.regularidade.outros}</p>

        {/* Pagamento */}
        <p style={{ marginBottom: "8px", textAlign: "justify" }}>
          <strong>DO PREÇO E FORMA DE PAGAMENTO:</strong> {valorFmt} ({valorExt}) SENDO {textoPagamento}.
        </p>

        {d.observacoes && (
          <p style={{ marginBottom: "14px", textAlign: "justify" }}>
            <strong>OBS:</strong> {d.observacoes.toUpperCase()}
          </p>
        )}

        {/* Cláusulas */}
        {[
          { n: "1ª", text: `O COMPRADOR assume a responsabilidade cível ou criminal, que porventura incidir sobre o bem objeto do presente contrato e que tiver fato gerador a partir da data da assinatura do presente contrato em diante;` },
          { n: "2ª", text: `Neste ato, fica o COMPRADOR imitido na posse do veículo, livre de quaisquer ônus, gravame ou encargo, ficando cumprida a tradição mediante a entrega das chaves e dos respectivos documentos de trânsito, como exceção feita ao Documento Único de Transferência (DUT), que permanecerá com o VENDEDOR pelo prazo de 30 (trinta) dias, contados a partir da quitação integral do veículo, para providenciar reconhecimento de firma por tabelião competente;` },
          { n: "3ª", text: `Fica a cargo do COMPRADOR, a partir desta data, o pagamento de IPVA, Seguro Obrigatório, licenciamento, tributos, taxas, tarifas e multas de trânsito que incidam ou venham a incidir sobre o referido veículo objeto do contrato, bem como total responsabilidade por acidentes de trânsito; já o pagamento de IPVA, Seguro Obrigatório, licenciamento, tributos, taxas, tarifas e multas de trânsito que forem devidos até a data do presente contrato, serão pagos pelo VENDEDOR;` },
          { n: "4ª", text: `As despesas com a transferência da propriedade e com financiamento são de responsabilidade exclusiva do COMPRADOR;` },
          { n: "5ª", text: `O COMPRADOR autoriza a cobrança de saldo, que porventura restar para quitação do veículo, objeto do presente contrato, através da emissão de boleto bancário;` },
          { n: "6ª", text: `Caso conste sobre o veículo algum debito, este fica a cargo do VENDEDOR, que autoriza desde já, a emissão de boleto registrado, que será enviado para o endereço do contrato, independentemente de notificação; estando a parte ciente que em caso de não pagamento, será o débito enviado para registro nos órgãos de proteção ao crédito (SCPC e Serasa);` },
          { n: "7ª", text: `O presente instrumento, em todos os seus termos, é feito em caráter irrevogável e irretratável;` },
          { n: "8ª", text: `O presente contrato obriga não só as partes contratantes, mas também seus eventuais herdeiros e sucessores, os quais se obrigam a fielmente cumpri-lo e respeitá-lo em todos os seus termos e condições;` },
          { n: "9ª", text: `Neste ato, o COMPRADOR confessa que lhe foi conferida a ampla liberdade para examinar o veículo e conduzi-lo até a oficina de sua confiança, sendo que os riscos corridos, por uma avaliação pouco precisa, são assumidos plenamente pelo COMPRADOR; motivos pelos quais recebe e aceita o veículo no estado em que se encontra (vistoria do veículo anexo ao presente instrumento) para nada mais reclamar seja judicial ou extrajudicialmente;` },
          { n: "10ª", text: `O VENDEDOR se responsabilizará pelo bom estado e perfeito funcionamento do motor e câmbio pelo prazo de 90 (noventa) dias conforme CDC Art. 26 II, limitado a 5.000 km (cinco mil quilômetros), se completados antes do mencionado prazo, contados a partir da data da assinatura do presente contrato;`, extras: ["A assistência, se pertinente, dar-se-á mediante a prévia, expressa e imediata comunicação e autorização para que o VENDEDOR providencie os reparos na empresa que este indicar, ficando expressamente excluída a responsabilidade e o fim da garantia se o COMPRADOR providenciar os reparos por outro meio ou empresa não indicada pelo VENDEDOR;", "O VENDEDOR, em caso de manutenção do veículo objeto do contrato, não fornecerá veículo reserva durante o período que durar a manutenção;"] },
          { n: "11ª", text: `O COMPRADOR declara estar ciente que, para sua segurança no sentido de evitar negligência e mau uso do veículo e outras consequências, que lhe sejam desfavoráveis, deve conferir todas as condições do veículo ora vendido e revisar constantemente no mínimo os seguintes itens: a) Olhar sempre a validade, vazamentos, e se o nível de óleo de motor/câmbio, diferencial, freios e da direção hidráulicas não precisam ser trocados ou completados; b) Conferir sempre o nível da água do radiador, e se não há vazamento no sistema de arrefecimento, principalmente na bomba d'água; c) Testar os freios, inclusive o freio de mão; d) Verificar imediatamente no ato na compra, se há necessidade de trocar a correia dentada.`, extras: ["Fica isento o VENDEDOR de qualquer responsabilidade por eventuais danos causados, pelo COMPRADOR, oriundos de negligência no uso do veículo."] },
          { n: "12ª", text: `Considerando que trata-se de contrato de compra e venda de veículo usado, não sendo possível saber ao certo a data da última troca de óleo do motor e câmbio e, ainda, da correia dentada, para veículos que possuem correia dentada, fica o COMPRADOR responsável pela manutenção total do veículo, sendo de sua responsabilidade a troca de óleo do motor e câmbio e da correia dentada imediatamente, sob pena de assumir os riscos decorrentes da não manutenção, ficando ciente o COMPRADOR que a garantia se extingue se não houver a apresentação da nota fiscal da troca de óleo do motor e câmbio, bem como correia dentada, em sendo o caso;` },
          { n: "13ª", text: `Perderá o direito à garantia se houver defeito de série e ou projeto, assim como se existir aviso de fabricante (recall) sobre qualquer parte do veículo, que possa influenciar nas partes cobertas pela garantia;` },
          { n: "14ª", text: `Perderá, também, o direito à garantia se o usuário/COMPRADOR deixar de comunicar por escrito a ocorrência de um sinistro tão logo tome conhecimento de sua ocorrência, de modo que teria sido possível evitar ou atenuar suas consequências;` },
          { n: "15ª", text: `Caso haja vício que torne impróprio ou inadequado o uso do veículo, poderá o COMPRADOR exigir a substituição das partes viciadas, no prazo de trinta dias, sendo que não sendo o vício sanado no prazo máximo de trinta dias, poderá exigir a substituição do produto por outro, ou a restituição imediata da quantia paga, ou ainda o abatimento proporcional do preço, nos termos estabelecidos do artigo 18 do Código de Defesa do Consumidor;` },
          { n: "16ª", text: `A parte que descumprir este contrato e der causa à sua rescisão, pagará à outra parte uma multa estipulada em 20% (vinte por cento) de seu valor devidamente atualizado, além de custas e honorários de advogado e demais despesas ao final verificadas e apuradas;` },
          { n: "17ª", text: `O COMPRADOR autoriza o VENDEDOR a utilizar sua imagem (FOTO/VÍDEO), obtidas em decorrência da presente transação, nas redes/mídias sociais existentes na INTERNET/rede mundial de computadores, como também autoriza utilizar de maneira fixada em outdoor;`, extras: ["O VENDEDOR não responderá pelos direitos autorais de quem captou imagem do COMPRADOR, sempre que a fixação desta tenha sido especialmente feita para os fins ora autorizados;", `O COMPRADOR recuperará todos os direitos aqui cedidos sobre sua imagem fixada em obra que não tiver sido publicada após 1 (um) ano da data deste instrumento, mediante simples carta do COMPRADOR ao VENDEDOR, solicitando a devolução do suporte físico correspondente;`, "O presente contrato confere uso de imagem exclusivamente ao VENDEDOR, obrigando-se o COMPRADOR a não autorizar para terceiros a utilização da imagem autorizada para uso com suporte neste contrato, salvo anuência escrita do VENDEDOR;"] },
          { n: "18ª", text: `Para dirimir quaisquer controvérsias oriundas do presente CONTRATO, as partes elegem o foro da comarca de ${d.cidade_contrato || d.vendedor.cidade}, ${d.vendedor.estado || "SP"} e, por estarem justos e contratados, firmam o presente instrumento, em duas vias de igual teor, na presença de 02 (duas) testemunhas, para que produza os efeitos e direitos legais.` },
        ].map((c, idx) => (
          <div key={idx} style={{ marginBottom: "8px", textAlign: "justify" }}>
            <p>
              <strong>Cláusula {c.n}.</strong> {c.text}
            </p>
            {c.extras?.map((e, ei) => (
              <p key={ei} style={{ marginTop: "4px", paddingLeft: "16px" }}>
                <strong>PARÁGRAFO {ei === 0 ? "PRIMEIRO" : ei === 1 ? "SEGUNDO" : "TERCEIRO"} -</strong> {e}
              </p>
            ))}
          </div>
        ))}

        {/* Data e local */}
        <p style={{ marginTop: "20px", marginBottom: "40px", textAlign: "center", fontWeight: "bold" }}>
          {(d.cidade_contrato || d.vendedor.cidade || "").toUpperCase()}{d.vendedor.estado ? ` - ${d.vendedor.estado.toUpperCase()}` : ""}, {textoData}{d.hora_assinatura ? ` às ${d.hora_assinatura}h` : ""}.
        </p>

        {/* Assinaturas */}
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: "40px" }}>
          <div style={{ textAlign: "center", width: "220px" }}>
            <div style={{ borderTop: "1px solid #000", marginBottom: "4px" }} />
            <p style={{ fontWeight: "bold" }}>VENDEDOR</p>
          </div>
          <div style={{ textAlign: "center", width: "220px" }}>
            <div style={{ borderTop: "1px solid #000", marginBottom: "4px" }} />
            <p style={{ fontWeight: "bold" }}>COMPRADOR</p>
          </div>
        </div>

        {/* Testemunhas */}
        <div style={{ marginBottom: "24px" }}>
          <p>Nome, RG e assinatura da Testemunha 1: ________________________________________</p>
        </div>
        <div>
          <p>Nome, RG e assinatura da Testemunha 2: ________________________________________</p>
        </div>
      </div>
    </>
  );
}
