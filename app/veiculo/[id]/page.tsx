"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import { PhotoGallery } from "@/components/PhotoGallery";
import { ArrowLeft, Save, Edit2, X, Check, Video } from "lucide-react";
import Link from "next/link";

export default function DetalheVeiculo() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;
  const [veiculo, setVeiculo] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // ✍️ Estados para Edição IA-First
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [nomeEditado, setNomeEditado] = useState("");
  const [roteiro, setRoteiro] = useState("");
  const [isGeneratingRoteiro, setIsGeneratingRoteiro] = useState(false);

  
  // 📈 Leads Interessados: Quem o Lucas (IA) está atendendonhecimento do Agente
  const [relatorioEditado, setRelatorioEditado] = useState("");
  const [salvandoRelatorio, setSalvandoRelatorio] = useState(false);

  // 🤝 Gestão de Vendedores (Closers)
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [vendedorId, setVendedorId] = useState("");

  // 📈 Monitoramento de Leads do Veículo
  const [leadsDoVeiculo, setLeadsDoVeiculo] = useState<any[]>([]);

  // Carrega os dados iniciais
  useEffect(() => {
    if (!id) return;
    const fetchVeiculo = async () => {
      const { data } = await supabase.from('veiculos').select('*').eq('id', id).single();
      // Converte para centavos para a máscara de input
      if (data) {
        data.preco_sugerido = (data.preco_sugerido || 0) * 100;
        setVeiculo(data);
      }
    };
    fetchVeiculo();
  }, [id]);

  // 🔄 Sincroniza os estados quando os dados chegam
  useEffect(() => {
    if (veiculo) {
      setNomeEditado(`${veiculo.marca} ${veiculo.modelo}`);
      setRelatorioEditado(veiculo.relatorio_ia || veiculo.detalhes_inspecao || "");
      setVendedorId(veiculo.vendedor_responsavel_id || "");
    }
  }, [veiculo]);

  // Flash: Busca a lista de closers cadastrados no sistema
  useEffect(() => {
    const carregarEquipe = async () => {
      const { data } = await supabase
        .from('vendedores')
        .select('id, nome')
        .order('nome');
      if (data) setVendedores(data);
    };
    carregarEquipe();
  }, []);

  // Flash: Busca no banco todos os leads que estão vinculados a este carro
  useEffect(() => {
    if (!id) return;
    const carregarLeads = async () => {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('veiculo_id', id)
        .order('updated_at', { ascending: false });
      
      if (data) {
        setLeadsDoVeiculo(data);
        // Flash: Carrega dados marketing se existirem
        if (veiculo?.roteiro_pitch) setRoteiro(veiculo.roteiro_pitch);
      }
    };

    carregarLeads();
  }, [id, veiculo]);

  // Flash: Função que vincula o veículo ao vendedor no banco de dados
  const handleAssinarVendedor = async (id: string) => {
    setVendedorId(id);
    const { error } = await supabase
      .from('veiculos')
      .update({ vendedor_responsavel_id: id })
      .eq('id', veiculo.id);
      
    if (error) {
      console.error("Erro ao assinar vendedor:", error);
      alert("Falha ao vincular responsável.");
    }
  };

  // 💾 Salvar Nome (Marca + Modelo) - Ajuste de Engenharia para Robustez
  const handleSalvarNome = async () => {
    if (!veiculo || !nomeEditado.trim()) return;

    // 1. Limpa espaços extras e divide o nome
    const palavras = nomeEditado.trim().split(/\s+/);
    
    // 2. Lógica de segurança para evitar campos vazios no Banco
    const novaMarca = palavras[0] || "Marca"; 
    const novoModelo = palavras.slice(1).join(" ") || "Modelo";

    try {
      const { error } = await supabase
        .from('veiculos')
        .update({ 
          marca: novaMarca, 
          modelo: novoModelo,
          ia_verificada: true 
        })
        .eq('id', veiculo.id);

      if (error) throw error;

      setIsEditingTitle(false);
      // 3. Força a atualização dos dados locais
      setVeiculo((prev: any) => ({ ...prev, marca: novaMarca, modelo: novoModelo, ia_verificada: true }));
      
    } catch (error: any) {
      console.error("Erro detalhado:", error);
      alert("Erro ao salvar nome: Verifique a conexão com o banco.");
    }
  };

  // 🧠 Salvar Relatório (Base de Conhecimento) - Versão Resistente
  const handleSalvarRelatorio = async () => {
    if (!veiculo || relatorioEditado === veiculo.relatorio_ia) return;

    setSalvandoRelatorio(true);
    
    try {
      const { error } = await supabase
        .from('veiculos')
        .update({ 
          relatorio_ia: relatorioEditado,
          ia_verificada: true 
        })
        .eq('id', veiculo.id);

      if (error) throw error;

      // Sucesso: atualiza o estado local do veículo para bater com o editor
      setVeiculo((prev: any) => ({ ...prev, relatorio_ia: relatorioEditado, ia_verificada: true }));
      
    } catch (error: any) {
      console.error("Erro ao salvar relatório:", error);
      alert("Erro ao salvar na base de conhecimento. Verifique o console.");
      // Se deu erro, volta o texto original para não parecer que salvou
      setRelatorioEditado(veiculo.relatorio_ia || veiculo.detalhes_inspecao || "");
    } finally {
      setSalvandoRelatorio(false);
    }
  };

  // Função para salvar as alterações no Supabase
  const handleSave = async () => {
    setIsSaving(true);
    const { error } = await supabase
      .from('veiculos')
      .update({ 
        preco_sugerido: veiculo.preco_sugerido / 100, // Converte de volta para salvar
        quilometragem_estimada: veiculo.quilometragem_estimada 
      })
      .eq('id', id);

    if (!error) {
      alert("Dados atualizados com sucesso! 🚀");
    }
    setIsSaving(false);
  };

  // Flash: Função de encerramento de venda
  const handleMarcarVendido = async () => {
    if (!veiculo) return;
    const confirmacao = window.confirm("Bora bater o martelo? Confirmar venda desta máquina?");
    if (!confirmacao) return;

    setIsSaving(true);
    try {
      const resp = await fetch("/api/veiculo/vender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: veiculo.id }),
      });
      const data = await resp.json();

      if (data.success) {
        alert(`🔥 VENDA REGISTRADA! Pátio atualizado. ${data.notifiedCount} leads foram notificados.`);
        router.push('/');
      } else {
        throw new Error(data.error || "Erro desconhecido");
      }
    } catch (error: any) {
      console.error("Erro ao registrar venda:", error);
      alert("Falha ao registrar venda: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Flash: Função que pede para a IA criar o roteiro de venda matador
  const handleGerarRoteiro = async () => {
    if (!veiculo) return;
    setIsGeneratingRoteiro(true);
    try {
      const resp = await fetch("/api/veiculo/roteiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: veiculo.id }),
      });
      const data = await resp.json();

      if (data.success) {
        setRoteiro(data.roteiro);
        alert("✨ ROTEIRO GERADO! A Marketing AI Factory concluiu o Pitch.");
      } else {
        throw new Error(data.error || "Erro desconhecido");
      }
    } catch (error: any) {
      console.error("Erro ao gerar roteiro:", error);
      alert("Falha ao gerar roteiro: " + error.message);
    } finally {
      setIsGeneratingRoteiro(false);
    }
  };


  if (!veiculo) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-pulse text-gray-400 font-bold uppercase tracking-widest text-xs">Carregando estoque...</div>
    </div>
  );

  return (
    <main className="flex-1 p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <Link href="/dashboard" className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-6 hover:text-red-600 transition-colors">
              <ArrowLeft size={12} /> Voltar ao Dashboard
            </Link>
            
            <div className="flex items-center gap-4 group">
              {isEditingTitle ? (
                <div className="flex items-center gap-3 w-full max-w-2xl bg-white p-2 rounded-2xl border border-gray-100 shadow-xl animate-in slide-in-from-left duration-200">
                  <input 
                    type="text" 
                    value={nomeEditado} 
                    onChange={(e) => setNomeEditado(e.target.value)}
                    className="flex-1 bg-transparent text-3xl font-black uppercase tracking-tighter italic outline-none text-gray-900 px-4"
                    autoFocus
                  />
                  <div className="flex gap-1 pr-2">
                    <button onClick={handleSalvarNome} className="p-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-all shadow-lg flex items-center justify-center">
                      <Check size={20} />
                    </button>
                    <button onClick={() => setIsEditingTitle(false)} className="p-3 bg-gray-100 text-gray-400 rounded-xl hover:text-gray-900 transition-all flex items-center justify-center">
                      <X size={20} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-5xl font-black uppercase tracking-tighter italic text-gray-900 leading-none">
                    {veiculo.marca} {veiculo.modelo}
                  </h1>
                  <button 
                    onClick={() => setIsEditingTitle(true)}
                    className="p-3 bg-gray-50 text-gray-300 hover:text-red-600 rounded-xl transition-all shadow-sm opacity-0 group-hover:opacity-100"
                    title="Editar Nome do Veículo"
                  >
                    <Edit2 size={18} />
                  </button>
                </>
              )}
            </div>
            
            <p className="text-red-600 font-bold tracking-[0.3em] uppercase mt-4 text-xs flex items-center gap-2 italic">
              {veiculo.versao} • {veiculo.ano_modelo}
              {veiculo.ia_verificada && (
                 <span className="bg-green-100 text-green-600 text-[8px] px-2 py-0.5 rounded-full font-black ml-2 not-italic">Verificado</span>
              )}
            </p>

            {/* Flash: Seletor de Responsável pela Venda */}
            <div className="mt-6 flex items-center gap-4 bg-white/50 backdrop-blur-sm p-4 rounded-[1.5rem] border border-gray-100 w-fit shadow-sm">
              <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-1">
                  Vendedor Responsável
                </span>
                <select 
                  value={vendedorId}
                  onChange={(e) => handleAssinarVendedor(e.target.value)}
                  className="bg-transparent text-[11px] font-black uppercase tracking-widest text-red-600 outline-none cursor-pointer hover:text-black transition-colors"
                >
                  <option value="">Aguardando Atribuição...</option>
                  {vendedores.map(v => (
                    <option key={v.id} value={v.id} className="text-slate-900 font-sans">
                      {v.nome}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Pequeno indicador visual de status */}
              <div className={`w-2 h-2 rounded-full ${vendedorId ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`}></div>
            </div>
          </div>
          <div className="flex gap-4">
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="px-8 py-4 bg-slate-900 text-white font-black uppercase italic rounded-3xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? "Salvando..." : <><Save size={20} /> Salvar Alterações</>}
              </button>

              <button 
                onClick={handleMarcarVendido}
                className="px-8 py-4 bg-green-600 text-white font-black uppercase italic rounded-3xl hover:bg-black transition-all shadow-xl shadow-green-100 flex items-center gap-2"
              >
                <Check size={20} /> Marcar como Vendido
              </button>
           </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Coluna da Esquerda: Galeria e Relatório */}
          <div className="lg:col-span-2 space-y-10">
            <PhotoGallery 
              veiculoId={veiculo.id} 
              fotos={veiculo.fotos} 
              onPhotosUpdated={(newPhotos) => setVeiculo({...veiculo, fotos: newPhotos})} 
            />
            
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm mt-10">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tighter italic text-gray-900">Base de Conhecimento do Agente</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Este texto alimenta a inteligência do WhatsApp</p>
                </div>
                {salvandoRelatorio && <span className="text-[10px] font-bold text-red-600 animate-pulse">SALVANDO...</span>}
              </div>

              <textarea
                value={relatorioEditado}
                onChange={(e) => setRelatorioEditado(e.target.value)}
                onBlur={handleSalvarRelatorio}
                className="w-full h-80 p-8 bg-gray-50 rounded-[2rem] border border-gray-100 text-sm leading-relaxed text-gray-600 outline-none focus:ring-4 focus:ring-red-500/5 transition-all font-medium resize-none shadow-inner"
                placeholder="A IA ainda não gerou o relatório para este veículo..."
              />
              
              <p className="mt-4 text-[9px] text-gray-400 italic font-medium">
                * Dica: Adicione detalhes como acessórios, histórico de revisões ou detalhes que a IA possa ter deixado passar no vídeo.
              </p>
            </div>
          </div>

          {/* Coluna da Direita: Ajuste de Valores */}
          <div className="space-y-6">
            <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-10">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-4">Preço de Venda</label>
                <div className="relative">
                  <span className="absolute left-0 bottom-2 text-gray-300 font-mono font-bold text-xl">R$</span>
                  <input 
                    type="text" 
                    value={!veiculo.preco_sugerido ? "" : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(veiculo.preco_sugerido / 100)} 
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      setVeiculo({...veiculo, preco_sugerido: raw === "" ? 0 : Number(raw)});
                    }}
                    className="w-full bg-transparent text-4xl font-mono font-black border-b border-gray-100 focus:border-red-600 outline-none pb-2 pl-10 transition-all text-gray-900"
                  />
                </div>
              </div>
              
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-4">Quilometragem</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={!veiculo.quilometragem_estimada ? "" : new Intl.NumberFormat('pt-BR').format(veiculo.quilometragem_estimada)} 
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      setVeiculo({...veiculo, quilometragem_estimada: raw === "" ? 0 : Number(raw)});
                    }}
                    className="w-full bg-transparent text-4xl font-mono font-black border-b border-gray-100 focus:border-red-600 outline-none pb-2 transition-all text-gray-900"
                  />
                  <span className="absolute right-0 bottom-2 text-gray-300 font-mono font-bold text-xl">KM</span>
                </div>
              </div>

              <div className="pt-6 grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Combustível</p>
                      <p className="text-xs font-black text-gray-900 uppercase">{veiculo.combustivel}</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Transmissão</p>
                      <p className="text-xs font-black text-gray-900 uppercase">{veiculo.cambio || 'Automático'}</p>
                  </div>
              </div>
            </div>

            <div className="bg-red-50 p-8 rounded-[2rem] border border-red-100">
                <p className="text-[9px] font-black text-red-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                    🔥 Lead Opportunity
                </p>
                <p className="text-xs text-red-900 font-medium leading-relaxed">
                    Este veículo está com alta procura. Recomendamos fixar no topo do estoque.
                </p>
            </div>

            {/* 🎬 Marketing AI Factory: Scripts para Redes Sociais */}
            <div className="mt-10 p-8 bg-slate-900 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/10 blur-3xl rounded-full -mr-16 -mt-16"></div>
              
              <div className="flex justify-between items-center mb-6 relative z-10">
                <h3 className="text-xl font-black uppercase italic tracking-tighter">Marketing AI Factory</h3>
                <span className="px-3 py-1 bg-red-600 text-[9px] font-black rounded-full uppercase">Ultra HD</span>
              </div>
              
              <p className="text-xs text-gray-400 mb-6 leading-relaxed relative z-10">
                Transforme os dados desta máquina em um pitch de venda matador para Instagram e TikTok em segundos.
              </p>

              <button 
                onClick={handleGerarRoteiro}
                disabled={isGeneratingRoteiro}
                className="w-full py-4 bg-white text-slate-900 font-black uppercase italic rounded-2xl hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-2 relative z-10 disabled:opacity-50"
              >
                {isGeneratingRoteiro ? "Roteirizando Pitch..." : <><Video size={18} /> Gerar Pitch de Venda</>}
              </button>

              {roteiro && (
                <div className="mt-8 p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50 relative z-10">
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-4">Roteiro Sugerido (Reels/TikTok)</p>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed italic">
                    {roteiro}
                  </pre>
                </div>
              )}
            </div>

            {/* 📈 Leads Interessados: Quem o Lucas (IA) está atendendo */}
            <div className="mt-10">
              <h3 className="text-xl font-black uppercase italic mb-6">Leads de Olho nesta Máquina</h3>
              
              <div className="grid gap-3">
                {leadsDoVeiculo.length > 0 ? (
                  leadsDoVeiculo.map((lead) => (
                    <div key={lead.id} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {/* Círculo de status colorido conforme a temperatura */}
                          <div className={`w-3 h-3 rounded-full ${
                            lead.status === 'QUENTE' ? 'bg-red-500 animate-pulse' : 
                            lead.status === 'MORNO' ? 'bg-amber-400' : 'bg-blue-400'
                          }`}></div>
                          
                          <div>
                            <p className="font-black uppercase text-sm leading-none">{lead.nome || "Cliente Interessado"}</p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                              Status: {lead.status}
                            </p>
                          </div>
                        </div>

                        <a 
                          href={`https://wa.me/${lead.wa_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase rounded-xl hover:bg-red-600 transition-colors"
                        >
                          Assumir Conversa
                        </a>
                      </div>
                      
                      {/* Flash: Adicionando o resumo da IA no card do lead */}
                      <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-50">
                        <p className="text-[11px] leading-relaxed text-gray-500 font-medium italic">
                          {lead.resumo_negociacao || "O Lucas (IA) ainda está qualificando este lead..."}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="bg-gray-50/50 p-8 rounded-3xl border-2 border-dashed border-gray-100 flex flex-col items-center justify-center text-center">
                    <p className="text-sm text-gray-400 italic">Nenhum lead conversando sobre este veículo ainda...</p>
                    <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mt-2">O Lucas (IA) está pronto para atender!</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
