"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import { PhotoGallery } from "@/components/PhotoGallery";
import { ArrowLeft, Save, Edit2, X, Check } from "lucide-react";
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
  
  // 🧠 Estados para Base de Conhecimento do Agente
  const [relatorioEditado, setRelatorioEditado] = useState("");
  const [salvandoRelatorio, setSalvandoRelatorio] = useState(false);

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
    }
  }, [veiculo]);

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

    if (!error) alert("Dados atualizados com sucesso! 🚀");
    setIsSaving(false);
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
          </div>
          <div className="flex gap-4">
             <button 
                onClick={handleSave}
                disabled={isSaving}
                className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-red-600 transition-all flex items-center gap-3 disabled:opacity-50"
              >
                <Save size={16} />
                {isSaving ? "Salvando..." : "Salvar Alterações"}
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
          </div>
        </div>
      </div>
    </main>
  );
}
