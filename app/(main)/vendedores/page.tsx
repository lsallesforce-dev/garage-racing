"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { supabase } from "@/lib/supabase";
import { UserPlus, MoreHorizontal, X, UserCircle, Upload, Zap, Phone, Edit, Trash2 } from "lucide-react";

export default function VendedoresPage() {
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVendedor, setEditingVendedor] = useState<any>(null); // Estado para track de edição
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // Estado Unificado do Formulário
  const [form, setForm] = useState({ nome: '', especialidade: '', whatsapp: '', foto_url: '' });

  const carregarEquipe = async () => {
    setLoading(true);
    const { data } = await supabase.from('vendedores').select('*').order('nome');
    if (data) setVendedores(data);
    setLoading(false);
  };

  useEffect(() => { carregarEquipe(); }, []);

  // 📸 Lógica de Upload de Foto (Ajuste de Engenharia para Link Direto e Limpo)
  const handlePhotoUpload = async (event: any) => {
    try {
      setUploading(true);
      const file = event.target.files[0];
      if (!file) return;

      // 1. Gera o nome do arquivo limpo (sem a pasta 'vendedores/' para evitar erros de permissão)
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;

      // 2. Faz o upload direto para o bucket 'fotos-vendedores'
      const { error: uploadError } = await supabase.storage
        .from('fotos-vendedores')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // 3. Pega a URL Pública
      const { data: { publicUrl } } = supabase.storage
        .from('fotos-vendedores')
        .getPublicUrl(fileName);

      console.log("🚀 URL Nova e Limpa:", publicUrl);

      // 4. Atualiza o estado forçando a re-renderização
      setForm(prev => ({ ...prev, foto_url: publicUrl }));

    } catch (error: any) {
      console.error("Erro no upload:", error);
      alert("Falha no upload: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  // 💾 Salvar ou Atualizar no Supabase
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingVendedor) {
      // Modo Edição (UPDATE)
      const { error } = await supabase
        .from('vendedores')
        .update(form)
        .eq('id', editingVendedor.id);
        
      if (error) {
        alert("Erro ao atualizar vendedor.");
        return;
      }
      setEditingVendedor(null);
    } else {
      // Modo Novo (INSERT)
      const { error } = await supabase
        .from('vendedores')
        .insert([form]);
        
      if (error) {
        alert("Erro ao cadastrar vendedor.");
        return;
      }
    }

    // Reset geral
    setForm({ nome: '', especialidade: '', whatsapp: '', foto_url: '' });
    setIsModalOpen(false);
    carregarEquipe();
  };

  // 🗑️ Excluir Vendedor
  const handleExcluir = async (id: string) => {
    if (confirm("⚠️ Deseja realmente remover este vendedor da unidade? Esta ação não pode ser desfeita.")) {
      const { error } = await supabase
        .from('vendedores')
        .delete()
        .eq('id', id);
        
      if (!error) {
        carregarEquipe();
      } else {
        alert("Erro ao excluir. O vendedor pode ter leads vinculados.");
      }
    }
  };

  // ✍️ Preparar Modal para Edição
  const abrirEdicao = (vendedor: any) => {
    setEditingVendedor(vendedor);
    setForm({ 
      nome: vendedor.nome, 
      especialidade: vendedor.especialidade, 
      whatsapp: vendedor.whatsapp, 
      foto_url: vendedor.foto_url 
    });
    setIsModalOpen(true);
  };

  return (
    <div className="flex bg-[#f4f4f2] min-h-screen text-slate-900 font-sans">
      <Sidebar />

      <main className="flex-1 p-10">
        <header className="flex justify-between items-center mb-10 pb-6 border-b border-gray-200">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">Equipe de Vendas</h1>
            <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold italic">Garage Racing • Gestão de Closers</p>
          </div>
          
          <button 
            onClick={() => { 
                setEditingVendedor(null); 
                setForm({ nome: '', especialidade: '', whatsapp: '', foto_url: '' }); 
                setIsModalOpen(true); 
            }}
            className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-black transition-all shadow-xl shadow-gray-900/10"
          >
            <UserPlus size={16} /> Cadastrar Vendedor
          </button>
        </header>

        {/* 🗂️ Grid de Cards com Foto e Ações CRUD */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {loading ? (
            <p className="col-span-full text-center py-20 font-bold text-gray-400 uppercase tracking-widest text-[10px] italic">Sincronizando equipe...</p>
          ) : vendedores.length > 0 ? (
            vendedores.map((v) => (
              <div key={v.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all relative group overflow-hidden flex flex-col">
                
                {/* 🛠️ Menu de Ações (Flutuante ao passar o mouse) */}
                <div className="absolute top-6 right-6 flex gap-2 opacity-30 group-hover:opacity-100 transition-all">
                  <button 
                    onClick={() => abrirEdicao(v)}
                    className="p-2 text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-white rounded-full shadow-sm border border-transparent hover:border-gray-100 transition-all"
                    title="Editar Vendedor"
                  >
                    <Edit size={16} />
                  </button>
                  <button 
                    onClick={() => handleExcluir(v.id)}
                    className="p-2 text-gray-400 hover:text-red-600 bg-gray-50 hover:bg-red-50 rounded-full shadow-sm border border-transparent hover:border-red-100 transition-all"
                    title="Excluir Vendedor"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                
                <div className="flex flex-col items-center text-center flex-1">
                  <div className="relative mb-6">
                    {v.foto_url ? (
                      <img src={v.foto_url} alt={v.nome} className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md ring-1 ring-gray-100" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-red-50 flex items-center justify-center text-red-600 font-black text-2xl shadow-md border-4 border-white">
                        {v.nome.substring(0,2).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute bottom-0 right-0 w-6 h-6 bg-green-500 border-4 border-white rounded-full shadow-sm"></div>
                  </div>
                  
                  <h3 className="font-black uppercase tracking-tight text-xl leading-tight text-gray-900 mb-1">{v.nome}</h3>
                  <p className="text-[10px] font-black text-red-600 uppercase tracking-[0.3em] mb-8">{v.especialidade || "Geral"}</p>
                  
                  <div className="w-full space-y-4 mb-10 text-left bg-gray-50/50 p-6 rounded-[2rem] border border-gray-100/10">
                    <div className="flex items-center gap-4 text-gray-600">
                      <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                        <Phone size={14} className="text-gray-400" />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-widest font-mono text-gray-900">{v.whatsapp}</span>
                    </div>
                    <div className="flex items-center gap-4 text-gray-600">
                      <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                        <Zap size={14} className="text-amber-500 fill-amber-500" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-900">{v.leads_atendidos || 0} Atendimentos</span>
                        <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Performance Global</span>
                      </div>
                    </div>
                  </div>

                  <a 
                    href={`https://wa.me/${v.whatsapp.replace(/\D/g, '')}`} 
                    target="_blank"
                    className="w-full py-5 bg-gray-900 hover:bg-green-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-[0.2em] transition-all shadow-xl shadow-gray-900/10 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Link WhatsApp
                  </a>
                </div>
              </div>
            ))
          ) : (
            <p className="col-span-full text-center py-20 font-bold text-gray-300 uppercase tracking-widest text-[9px]">A unidade ainda não possui vendedores cadastrados.</p>
          )}
        </div>

        {/* 🚪 Modal Dual (Cadastrar e Editar) */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
            <div className="bg-white w-full max-w-lg rounded-[3rem] p-12 shadow-2xl relative animate-in fade-in zoom-in duration-200 border border-gray-100">
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="absolute top-10 right-10 text-gray-400 hover:text-black transition-all p-2 hover:bg-gray-50 rounded-2xl"
              >
                <X size={26} />
              </button>
              
              <h2 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900 mb-2">
                {editingVendedor ? 'Editar Perfil' : 'Novo Closer'}
              </h2>
              <p className="text-gray-400 text-[10px] font-black uppercase tracking-[0.3em] mb-10 pb-6 border-b border-gray-100">
                {editingVendedor ? 'Atualizar dados do vendedor' : 'Registrar Vendedor no Pátio Digital'}
              </p>

              <form onSubmit={handleSave} className="space-y-6">
                
                {/* Área de Upload de Foto com Cache Buster */}
                <div className="flex flex-col items-center gap-5 bg-gray-50/80 p-8 rounded-[2.5rem] border border-gray-100 mb-8">
                  {form.foto_url ? (
                    <img 
                      src={`${form.foto_url}?t=${new Date().getTime()}`} 
                      alt="Preview" 
                      className="w-28 h-28 rounded-full object-cover border-4 border-white shadow-xl ring-1 ring-gray-100" 
                    />
                  ) : (
                    <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center text-gray-100 shadow-inner">
                      <UserCircle size={112} strokeWidth={1} />
                    </div>
                  )}
                  <label className="flex items-center gap-2 px-6 py-3 bg-white rounded-xl border border-gray-200 text-gray-600 font-black uppercase text-[10px] tracking-widest cursor-pointer hover:border-red-600 hover:text-red-600 transition-all shadow-sm">
                    {uploading ? (
                      <span className="w-4 h-4 border-2 border-red-600 border-t-transparent animate-spin rounded-full"></span>
                    ) : (
                      <Upload size={14} />
                    )}
                    {uploading ? "Sincronizando..." : "Trocar Foto Perfil"}
                    <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" disabled={uploading} />
                  </label>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 ml-4 mb-2 block tracking-widest">Nome Completo</label>
                  <input 
                    required 
                    type="text" 
                    value={form.nome} 
                    onChange={e => setForm({...form, nome: e.target.value})} 
                    className="w-full p-5 bg-gray-50 rounded-[1.5rem] border border-gray-100 outline-none focus:ring-4 focus:ring-red-500/10 font-bold text-gray-900 transition-all placeholder:text-gray-300"
                    placeholder="Ex: Beto Martins"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 ml-4 mb-2 block tracking-widest">Especialidade</label>
                    <input 
                      type="text" 
                      value={form.especialidade} 
                      onChange={e => setForm({...form, especialidade: e.target.value})} 
                      className="w-full p-5 bg-gray-50 rounded-[1.5rem] border border-gray-100 outline-none focus:ring-4 focus:ring-red-500/10 font-bold text-gray-900 transition-all placeholder:text-gray-300" 
                      placeholder="Ex: Motos Esportivas"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 ml-4 mb-2 block tracking-widest">WhatsApp (com DDD)</label>
                    <input 
                      required 
                      type="text" 
                      value={form.whatsapp} 
                      onChange={e => setForm({...form, whatsapp: e.target.value})} 
                      className="w-full p-5 bg-gray-50 rounded-[1.5rem] border border-gray-100 outline-none focus:ring-4 focus:ring-red-500/10 font-bold text-gray-900 font-mono transition-all placeholder:text-gray-300" 
                      placeholder="17991234567" 
                    />
                  </div>
                </div>
                
                <button 
                  type="submit" 
                  disabled={uploading} 
                  className="w-full py-6 mt-6 bg-red-600 text-white font-black uppercase tracking-[0.2em] text-[11px] rounded-[1.5rem] shadow-xl shadow-red-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {uploading ? "Aguarde o Upload..." : editingVendedor ? 'Salvar Edição' : 'Finalizar Cadastro'}
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
