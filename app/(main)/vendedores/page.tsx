"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { UserPlus, MoreHorizontal, X, UserCircle, Upload, Zap, Phone, Edit, Trash2, KeyRound } from "lucide-react";

export default function VendedoresPage() {
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVendedor, setEditingVendedor] = useState<any>(null); // Estado para track de edição
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // Estado Unificado do Formulário
  const [form, setForm] = useState({ nome: '', especialidade: '', whatsapp: '', foto_url: '', role: 'vendedor', email: '', senha: '' });
  const [savingLogin, setSavingLogin] = useState(false);
  const [resetVendedor, setResetVendedor] = useState<any>(null);
  const [resetSenha, setResetSenha] = useState('');
  const [savingReset, setSavingReset] = useState(false);

  const carregarEquipe = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase.from('vendedores').select('*').eq('user_id', user.id).order('nome');
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
    setSavingLogin(true);

    const { nome, especialidade, whatsapp, foto_url, role, email, senha } = form;
    const dadosBase = { nome, especialidade, whatsapp, foto_url, role };

    try {
      if (editingVendedor) {
        // Modo Edição (UPDATE)
        const { error } = await supabase
          .from('vendedores')
          .update(dadosBase)
          .eq('id', editingVendedor.id);

        if (error) { alert("Erro ao atualizar vendedor."); return; }

        // Se admin informou email (novo ou alteração de credenciais)
        if (email) {
          const res = await fetch('/api/vendedores/criar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vendedorId: editingVendedor.id, email, senha: senha || undefined, authUserId: editingVendedor.auth_user_id }),
          });
          const data = await res.json();
          if (!res.ok) { alert("Erro ao atualizar acesso: " + data.error); return; }
        }

        setEditingVendedor(null);
      } else {
        // Modo Novo (INSERT)
        const { data: { user } } = await supabase.auth.getUser();
        const { data: inserted, error } = await supabase
          .from('vendedores')
          .insert([{ ...dadosBase, user_id: user?.id }])
          .select('id')
          .single();

        if (error || !inserted) { alert("Erro ao cadastrar vendedor."); return; }

        // Criar login se email foi informado
        if (email && senha) {
          const res = await fetch('/api/vendedores/criar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vendedorId: inserted.id, email, senha }),
          });
          const data = await res.json();
          if (!res.ok) { alert("Vendedor cadastrado, mas erro ao criar login: " + data.error); }
        }
      }
    } finally {
      setSavingLogin(false);
    }

    // Reset geral
    setForm({ nome: '', especialidade: '', whatsapp: '', foto_url: '', role: 'vendedor', email: '', senha: '' });
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

  // 🔑 Reset de Senha
  const handleResetSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetSenha || resetSenha.length < 6) { alert("Senha deve ter ao menos 6 caracteres."); return; }
    setSavingReset(true);
    try {
      const res = await fetch('/api/vendedores/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendedorId: resetVendedor.id, email: resetVendedor.email, senha: resetSenha, authUserId: resetVendedor.auth_user_id }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Erro ao redefinir senha: " + data.error); return; }
      alert(`Senha redefinida! Credenciais enviadas via WhatsApp para ${resetVendedor.nome}.`);
      setResetVendedor(null);
      setResetSenha('');
    } finally {
      setSavingReset(false);
    }
  };

  // ✍️ Preparar Modal para Edição
  const abrirEdicao = (vendedor: any) => {
    setEditingVendedor(vendedor);
    setForm({
      nome: vendedor.nome,
      especialidade: vendedor.especialidade,
      whatsapp: vendedor.whatsapp,
      foto_url: vendedor.foto_url,
      role: vendedor.role || 'vendedor',
      email: vendedor.email || '',
      senha: '',
    });
    setIsModalOpen(true);
  };

  return (
    <div className="flex-1 bg-[#f4f4f2] min-h-screen text-slate-900 font-sans">
      <main className="p-10">
        <header className="flex justify-between items-center mb-10 pb-6 border-b border-gray-200">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">Equipe de Vendas</h1>
            <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold italic">AutoZap • Gestão de Closers</p>
          </div>
          
          <button 
            onClick={() => {
                setEditingVendedor(null);
                setForm({ nome: '', especialidade: '', whatsapp: '', foto_url: '', role: 'vendedor', email: '', senha: '' });
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
                  {v.auth_user_id && (
                    <button
                      onClick={() => { setResetVendedor(v); setResetSenha(''); }}
                      className="p-2 text-gray-400 hover:text-amber-600 bg-gray-50 hover:bg-amber-50 rounded-full shadow-sm border border-transparent hover:border-amber-100 transition-all"
                      title="Redefinir Senha"
                    >
                      <KeyRound size={16} />
                    </button>
                  )}
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
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] font-black text-red-600 uppercase tracking-[0.3em]">{v.especialidade || "Geral"}</p>
                    {v.role === 'master' && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black uppercase tracking-widest rounded-full border border-amber-200">Master</span>
                    )}
                  </div>
                  <div className="mb-8" />
                  
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
            <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-200 border border-gray-100 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setIsModalOpen(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-black transition-all p-1.5 hover:bg-gray-50 rounded-xl"
              >
                <X size={20} />
              </button>

              <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 mb-1">
                {editingVendedor ? 'Editar Perfil' : 'Novo Vendedor'}
              </h2>
              <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4 pb-4 border-b border-gray-100">
                {editingVendedor ? 'Atualizar dados do vendedor' : 'Registrar vendedor no painel'}
              </p>

              <form onSubmit={handleSave} className="space-y-4">

                {/* Foto */}
                <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                  {form.foto_url ? (
                    <img
                      src={`${form.foto_url}?t=${new Date().getTime()}`}
                      alt="Preview"
                      className="w-16 h-16 rounded-full object-cover border-2 border-white shadow"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-gray-200 shadow-inner">
                      <UserCircle size={64} strokeWidth={1} />
                    </div>
                  )}
                  <label className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-gray-200 text-gray-600 font-black uppercase text-[10px] tracking-widest cursor-pointer hover:border-red-600 hover:text-red-600 transition-all shadow-sm">
                    {uploading ? <span className="w-3 h-3 border-2 border-red-600 border-t-transparent animate-spin rounded-full" /> : <Upload size={12} />}
                    {uploading ? "Enviando..." : "Trocar Foto"}
                    <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" disabled={uploading} />
                  </label>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">Nome Completo</label>
                  <input
                    required type="text" value={form.nome}
                    onChange={e => setForm({...form, nome: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 outline-none focus:border-red-500 text-sm font-bold text-gray-900 placeholder:text-gray-300"
                    placeholder="Ex: Beto Martins"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">Especialidade</label>
                    <input type="text" value={form.especialidade}
                      onChange={e => setForm({...form, especialidade: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 outline-none focus:border-red-500 text-sm font-bold text-gray-900 placeholder:text-gray-300"
                      placeholder="Ex: SUVs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">WhatsApp (DDI+DDD)</label>
                    <input required type="text" value={form.whatsapp}
                      onChange={e => setForm({...form, whatsapp: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 outline-none focus:border-red-500 text-sm font-mono text-gray-900 placeholder:text-gray-300"
                      placeholder="5517991234567"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">Nível de Acesso</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['vendedor', 'master'] as const).map(r => (
                      <button key={r} type="button" onClick={() => setForm({...form, role: r})}
                        className={`py-2.5 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest transition-all ${
                          form.role === r
                            ? r === 'master' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-100 bg-gray-50 text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        {r === 'master' ? '⭐ Master' : '👤 Vendedor'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Acesso ao Painel */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">
                      {editingVendedor ? 'Email de Acesso' : 'Email de Acesso (opcional)'}
                    </label>
                    <input type="email" value={form.email}
                      onChange={e => setForm({...form, email: e.target.value})}
                      className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 outline-none focus:border-red-500 text-sm font-mono text-gray-900 placeholder:text-gray-300"
                      placeholder="vendedor@garagem.com"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">
                      {editingVendedor ? 'Nova Senha (deixe em branco para manter)' : 'Senha de Acesso'}
                    </label>
                    <input type="password" value={form.senha}
                      onChange={e => setForm({...form, senha: e.target.value})}
                      className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 outline-none focus:border-red-500 text-sm font-mono text-gray-900 placeholder:text-gray-300"
                      placeholder={editingVendedor ? '••••••••' : 'Mínimo 6 caracteres'}
                      minLength={form.senha ? 6 : undefined}
                    />
                  </div>
                  <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">
                    Acesso restrito a Chat + Estoque Inteligente
                  </p>
                </div>

                <button type="submit" disabled={uploading || savingLogin}
                  className="w-full py-3 bg-red-600 text-white font-black uppercase tracking-widest text-[11px] rounded-xl shadow-lg shadow-red-600/20 hover:bg-red-700 transition-all disabled:opacity-50"
                >
                  {savingLogin ? "Criando acesso..." : uploading ? "Aguarde..." : editingVendedor ? 'Salvar' : 'Cadastrar'}
                </button>
              </form>
            </div>
          </div>
        )}
        {/* 🔑 Modal Reset de Senha */}
        {resetVendedor && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
            <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-200 border border-gray-100">
              <button
                onClick={() => setResetVendedor(null)}
                className="absolute top-4 right-4 text-gray-400 hover:text-black transition-all p-1.5 hover:bg-gray-50 rounded-xl"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <KeyRound size={18} className="text-amber-600" />
                </div>
                <div>
                  <h2 className="text-base font-black uppercase tracking-tight text-gray-900">Redefinir Senha</h2>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{resetVendedor.nome}</p>
                </div>
              </div>

              <form onSubmit={handleResetSenha} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">Email</label>
                  <input
                    type="email" value={resetVendedor.email || ''} readOnly
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-100 text-sm font-mono text-gray-500 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block tracking-widest">Nova Senha</label>
                  <input
                    type="password" required minLength={6}
                    value={resetSenha} onChange={e => setResetSenha(e.target.value)}
                    autoFocus
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 outline-none focus:border-amber-500 text-sm font-mono text-gray-900 placeholder:text-gray-300"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">
                  A nova senha será enviada via WhatsApp para o vendedor.
                </p>
                <button type="submit" disabled={savingReset}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-widest text-[11px] rounded-xl shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
                >
                  {savingReset ? "Redefinindo..." : "Redefinir e Enviar"}
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
