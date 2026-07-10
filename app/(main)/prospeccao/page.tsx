"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Plus,
  Trash2,
  Search,
  Loader2,
  Eye,
  EyeOff,
  RefreshCw,
  Car,
  X,
  Save,
  Upload,
  Lock,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Lista = "A" | "B" | "C";

interface Contato {
  id: string;
  nome: string;
  telefone: string;
  lista: Lista;
  created_at: string;
}

interface Campanha {
  id: string;
  status: "ativa" | "pausada" | "concluida" | "cancelada";
  listas: string[];
  criado_em: string;
  veiculo: { marca: string; modelo: string; ano_modelo: number | string | null } | null;
  total: number;
  enviados: number;
  erros: number;
}

interface Veiculo {
  id: string;
  marca: string;
  modelo: string;
  ano_modelo: number | string | null;
  preco_sugerido: number | null;
  fotos: string[] | null;
  capa_marketing_url: string | null;
}

interface CanalConfig {
  id: string | null;
  baseUrl: string;
  token: string;
  capDia: number;
  janelaInicio: number;
  janelaFim: number;
  ativadaEm: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPreco = (v: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

function formatTelefone(t: string): string {
  const d = t.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return t;
}

const LISTAS: Lista[] = ["A", "B", "C"];

const badgeLista: Record<Lista, string> = {
  A: "bg-gray-900 text-white",
  B: "bg-gray-500 text-white",
  C: "bg-gray-200 text-gray-600",
};

const badgeStatus: Record<Campanha["status"], string> = {
  ativa: "bg-green-100 text-green-700",
  pausada: "bg-amber-100 text-amber-700",
  concluida: "bg-gray-100 text-gray-500",
  cancelada: "bg-red-100 text-red-600",
};

const labelStatus: Record<Campanha["status"], string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const inputCls =
  "bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition";
const labelCls = "text-[10px] font-black uppercase tracking-widest text-gray-500";
const btnPrimario =
  "px-6 py-3 bg-gray-900 text-white rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-green-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2";

// ─── Página ───────────────────────────────────────────────────────────────────

export default function ProspeccaoPage() {
  // Gate / config
  const [carregando, setCarregando] = useState(true);
  const [habilitado, setHabilitado] = useState(false);
  // Trava de senha por tenant (config_garage.transmissao_senha). O caminho normal
  // é o modal da sidebar (grava prospeccao_unlocked na sessão); este gate na
  // página cobre o acesso por URL direta. Senha vazia = sem trava.
  const [senhaConfig, setSenhaConfig] = useState<string>("");
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [senhaInput, setSenhaInput] = useState("");
  const [senhaErro, setSenhaErro] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");   // campo editável de troca de senha
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [salvoSenha, setSalvoSenha] = useState(false);
  const [userId, setUserId] = useState("");
  const [canal, setCanal] = useState<CanalConfig>({
    id: null,
    baseUrl: "",
    token: "",
    capDia: 150,
    janelaInicio: 8,
    janelaFim: 18,
    ativadaEm: null,
  });
  const [showToken, setShowToken] = useState(false);
  const [salvandoCanal, setSalvandoCanal] = useState(false);
  const [salvoCanal, setSalvoCanal] = useState(false);

  // Contatos
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregandoContatos, setCarregandoContatos] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [lista, setLista] = useState<Lista>("A");
  const [adicionando, setAdicionando] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importTexto, setImportTexto] = useState("");
  const [importando, setImportando] = useState(false);
  const [importResultado, setImportResultado] = useState<string | null>(null);
  const [filtroLista, setFiltroLista] = useState<Lista | "">("");
  const [buscaNome, setBuscaNome] = useState("");

  // Disparo
  const [modalAberto, setModalAberto] = useState(false);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [veiculosCarregados, setVeiculosCarregados] = useState(false);
  const [carregandoVeiculos, setCarregandoVeiculos] = useState(false);
  const [veiculoSelecionado, setVeiculoSelecionado] = useState<Veiculo | null>(null);
  const [listasSelecionadas, setListasSelecionadas] = useState<Lista[]>([]);
  const [disparando, setDisparando] = useState(false);

  // Campanhas
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [carregandoCampanhas, setCarregandoCampanhas] = useState(false);

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const carregarContatos = async () => {
    setCarregandoContatos(true);
    try {
      const res = await fetch("/api/transmissao/contatos");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setContatos(data.contatos ?? []);
    } catch {
    } finally {
      setCarregandoContatos(false);
    }
  };

  const carregarCampanhas = async () => {
    setCarregandoCampanhas(true);
    try {
      const res = await fetch("/api/transmissao/campanhas");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setCampanhas(data.campanhas ?? []);
    } catch {
    } finally {
      setCarregandoCampanhas(false);
    }
  };

  // Auto-refresh: enquanto tiver campanha ativa, o cron manda mensagens em
  // background (lote a cada 2min, 20-45s de intervalo dentro do lote) e o
  // progresso na tela ficava parado até dar F5 ou clicar em atualizar.
  // Sondagem silenciosa a cada 8s — pega cada envio individual bem antes do
  // próximo, sem precisar de infra de push (websocket/SSE) pra um card simples.
  const temCampanhaAtiva = campanhas.some((c) => c.status === "ativa");
  useEffect(() => {
    if (!temCampanhaAtiva) return;
    const id = setInterval(carregarCampanhas, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temCampanhaAtiva]);

  // Trava de senha: já desbloqueada nesta sessão do navegador? (não repergunta
  // ao navegar entre páginas; some ao fechar o navegador)
  useEffect(() => {
    if (sessionStorage.getItem("prospeccao_unlocked") === "1") setDesbloqueado(true);
  }, []);

  const tentarDesbloquear = (e: React.FormEvent) => {
    e.preventDefault();
    if (senhaInput === senhaConfig) {
      sessionStorage.setItem("prospeccao_unlocked", "1");
      setDesbloqueado(true);
      setSenhaErro(false);
      setSenhaInput("");
    } else {
      setSenhaErro(true);
    }
  };

  // ── Load inicial: gate + config (padrão configuracoes) ─────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setCarregando(false);
        return;
      }
      setUserId(user.id);
      supabase
        .from("config_garage")
        .select(
          "id, transmissao_habilitada, transmissao_avisa_base_url, transmissao_avisa_token, transmissao_cap_dia, transmissao_janela_inicio, transmissao_janela_fim, transmissao_ativada_em, transmissao_senha"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (error) console.error("❌ config_garage load error:", error);
          const row = data?.[0];
          if (row) {
            setCanal({
              id: row.id ?? null,
              baseUrl: row.transmissao_avisa_base_url ?? "",
              token: row.transmissao_avisa_token ?? "",
              capDia: row.transmissao_cap_dia ?? 150,
              janelaInicio: row.transmissao_janela_inicio ?? 8,
              janelaFim: row.transmissao_janela_fim ?? 18,
              ativadaEm: row.transmissao_ativada_em ?? null,
            });
            const senha = row.transmissao_senha ?? "";
            setSenhaConfig(senha);
            setSenhaAtual(senha); // preenche o campo de troca de senha
            if (!senha) setDesbloqueado(true); // sem senha configurada = sem trava
            if (row.transmissao_habilitada) {
              setHabilitado(true);
              carregarContatos();
              carregarCampanhas();
            }
          }
          setCarregando(false);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Contatos: adicionar / importar / excluir ────────────────────────────────

  const handleAdicionar = async () => {
    if (!nome.trim() || !telefone.replace(/\D/g, "")) {
      alert("Preencha nome e telefone.");
      return;
    }
    setAdicionando(true);
    try {
      const res = await fetch("/api/transmissao/contatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), telefone: telefone.trim(), lista }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `Erro ${res.status} ao adicionar contato.`);
        return;
      }
      setNome("");
      setTelefone("");
      carregarContatos();
    } catch {
      alert("Falha na conexão. Tente novamente.");
    } finally {
      setAdicionando(false);
    }
  };

  const handleImportar = async () => {
    const linhas = importTexto.split("\n").map((l) => l.trim()).filter(Boolean);
    const lote: { nome: string; telefone: string; lista: Lista }[] = [];
    for (const linha of linhas) {
      const partes = linha.split(/[;,\t]/).map((p) => p.trim());
      if (partes.length < 2) continue;
      const [n, t] = partes;
      const listaRaw = (partes[2] || "A").toUpperCase();
      const l: Lista = LISTAS.includes(listaRaw as Lista) ? (listaRaw as Lista) : "A";
      if (!n || !t.replace(/\D/g, "")) continue;
      lote.push({ nome: n, telefone: t, lista: l });
    }
    if (lote.length === 0) {
      alert("Nenhuma linha válida. Use o formato: Nome;Telefone;Lista (uma por linha).");
      return;
    }
    setImportando(true);
    setImportResultado(null);
    try {
      const res = await fetch("/api/transmissao/contatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contatos: lote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `Erro ${res.status} ao importar.`);
        return;
      }
      setImportResultado(
        `${data.inseridos ?? 0} importados, ${data.ignorados ?? 0} ignorados (inválidos/duplicados)`
      );
      setImportTexto("");
      carregarContatos();
    } catch {
      alert("Falha na conexão. Tente novamente.");
    } finally {
      setImportando(false);
    }
  };

  const handleExcluir = async (c: Contato) => {
    if (!confirm(`Excluir o contato ${c.nome}?`)) return;
    const res = await fetch(`/api/transmissao/contatos?id=${c.id}`, { method: "DELETE" });
    if (res.ok) {
      setContatos((prev) => prev.filter((x) => x.id !== c.id));
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Erro ao excluir contato.");
    }
  };

  // ── Disparo ─────────────────────────────────────────────────────────────────

  const abrirModalEstoque = async () => {
    setModalAberto(true);
    if (veiculosCarregados || !userId) return;
    setCarregandoVeiculos(true);
    const { data } = await supabase
      .from("veiculos")
      .select("id, marca, modelo, ano_modelo, preco_sugerido, fotos, capa_marketing_url")
      .eq("user_id", userId)
      .eq("status_venda", "DISPONIVEL")
      .order("created_at", { ascending: false });
    setVeiculos((data as Veiculo[]) ?? []);
    setVeiculosCarregados(true);
    setCarregandoVeiculos(false);
  };

  const toggleListaDisparo = (l: Lista) =>
    setListasSelecionadas((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );

  const contagem: Record<Lista, number> = { A: 0, B: 0, C: 0 };
  contatos.forEach((c) => {
    if (contagem[c.lista] !== undefined) contagem[c.lista]++;
  });

  const totalDisparo = listasSelecionadas.reduce((acc, l) => acc + contagem[l], 0);

  const handleDisparar = async () => {
    if (!veiculoSelecionado || listasSelecionadas.length === 0) return;
    const nomeCarro = `${veiculoSelecionado.marca} ${veiculoSelecionado.modelo}`;
    const listasOrd = [...listasSelecionadas].sort();
    if (
      !confirm(
        `Disparar ${nomeCarro} para ${totalDisparo} contatos (listas ${listasOrd.join(", ")})? O envio é gradual e pode levar dias.`
      )
    )
      return;
    setDisparando(true);
    try {
      const res = await fetch("/api/transmissao/campanhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: veiculoSelecionado.id, listas: listasOrd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `Erro ${res.status} ao criar campanha.`);
        return;
      }
      alert(`Campanha criada! ${data.total} envios na fila — o disparo começa automaticamente, aos poucos.`);
      setVeiculoSelecionado(null);
      setListasSelecionadas([]);
      carregarCampanhas();
    } catch {
      alert("Falha na conexão. Tente novamente.");
    } finally {
      setDisparando(false);
    }
  };

  // ── Campanhas: ações ────────────────────────────────────────────────────────

  const acaoCampanha = async (id: string, acao: "pausar" | "retomar" | "cancelar") => {
    if (acao === "cancelar" && !confirm("Cancelar esta campanha? Os envios restantes não serão feitos.")) return;
    const res = await fetch("/api/transmissao/campanhas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, acao }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || `Erro ${res.status}.`);
      return;
    }
    carregarCampanhas();
  };

  // ── Canal: salvar ───────────────────────────────────────────────────────────

  const handleSalvarCanal = async () => {
    setSalvandoCanal(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");
      const ativarAgora = !!canal.baseUrl && !!canal.token && !canal.ativadaEm;
      const agora = new Date().toISOString();
      const { error } = await supabase
        .from("config_garage")
        .upsert(
          {
            ...(canal.id ? { id: canal.id } : {}),
            user_id: user.id,
            transmissao_avisa_base_url: canal.baseUrl || null,
            transmissao_avisa_token: canal.token || null,
            transmissao_cap_dia: canal.capDia,
            transmissao_janela_inicio: canal.janelaInicio,
            transmissao_janela_fim: canal.janelaFim,
            ...(ativarAgora ? { transmissao_ativada_em: agora } : {}),
          },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      if (ativarAgora) setCanal((c) => ({ ...c, ativadaEm: agora }));
      setSalvoCanal(true);
      setTimeout(() => setSalvoCanal(false), 3000);
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setSalvandoCanal(false);
    }
  };

  // ── Senha de acesso: salvar (só o dono, já dentro da página, pode trocar) ────
  const handleSalvarSenha = async () => {
    setSalvandoSenha(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");
      const novaSenha = senhaAtual.trim();
      const { error } = await supabase
        .from("config_garage")
        .upsert(
          { ...(canal.id ? { id: canal.id } : {}), user_id: user.id, transmissao_senha: novaSenha || null },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      setSenhaConfig(novaSenha);
      setSalvoSenha(true);
      setTimeout(() => setSalvoSenha(false), 3000);
    } catch (err: any) {
      alert("Erro ao salvar senha: " + err.message);
    } finally {
      setSalvandoSenha(false);
    }
  };

  // ── Derivados ───────────────────────────────────────────────────────────────

  const contatosFiltrados = contatos.filter(
    (c) =>
      (!filtroLista || c.lista === filtroLista) &&
      (!buscaNome || c.nome.toLowerCase().includes(buscaNome.toLowerCase()))
  );

  const fotoDe = (v: Veiculo) => v.capa_marketing_url || v.fotos?.[0] || null;

  // ── Render ──────────────────────────────────────────────────────────────────

  const header = (
    <header className="mb-8 pb-6 border-b border-gray-200">
      <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
        Prospecção
      </h1>
      <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">
        Listas de transmissão pessoais — envio gradual e seguro
      </p>
    </header>
  );

  if (carregando) {
    return (
      <main className="flex-1 p-4 sm:p-10 bg-[#efefed] min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </main>
    );
  }

  if (!habilitado) {
    return (
      <main className="flex-1 p-4 sm:p-10 bg-[#efefed] min-h-screen">
        {header}
        <div className="max-w-2xl">
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-10 flex flex-col items-center text-center gap-3">
            <Lock size={28} className="text-gray-300" />
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
              Pacote Prospecção não habilitado
            </h2>
            <p className="text-xs text-gray-500">
              Fale com o suporte AutoZap para ativar as listas de transmissão na sua conta.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Trava de senha — só aparece o conteúdo depois de digitar a senha correta
  if (!desbloqueado) {
    return (
      <main className="flex-1 p-4 sm:p-10 bg-[#efefed] min-h-screen">
        {header}
        <div className="max-w-md">
          <form
            onSubmit={tentarDesbloquear}
            className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-10 flex flex-col items-center text-center gap-4"
          >
            <Lock size={28} className="text-gray-400" />
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
              Área protegida
            </h2>
            <p className="text-xs text-gray-500 -mt-2">
              Digite a senha para acessar suas listas de transmissão.
            </p>
            <input
              type="password"
              autoFocus
              value={senhaInput}
              onChange={(e) => { setSenhaInput(e.target.value); setSenhaErro(false); }}
              placeholder="Senha"
              className={`w-full text-center bg-[#f5f5f3] border rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 transition ${
                senhaErro
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-gray-200 focus:border-green-500 focus:ring-green-500"
              }`}
            />
            {senhaErro && <p className="text-[11px] text-red-500 -mt-2">Senha incorreta.</p>}
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-green-600 transition"
            >
              Acessar
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 p-4 sm:p-10 bg-[#efefed] min-h-screen">
      {header}

      <div className="max-w-2xl flex flex-col gap-6">

        {/* ══ Card 1 — Contatos ══════════════════════════════════════════════ */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Contatos
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Seus contatos pessoais, organizados em listas A, B e C.
          </p>

          {/* Form inline */}
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome"
              className={`${inputCls} flex-1 min-w-0`}
            />
            <input
              type="text"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(17) 99999-9999"
              className={`${inputCls} sm:w-44`}
            />
            <select
              value={lista}
              onChange={(e) => setLista(e.target.value as Lista)}
              className={`${inputCls} sm:w-24`}
            >
              {LISTAS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <button onClick={handleAdicionar} disabled={adicionando} className={btnPrimario}>
              {adicionando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Adicionar
            </button>
          </div>

          {/* Importar em massa */}
          <button
            onClick={() => setShowImport((v) => !v)}
            className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1.5 mb-4"
          >
            <Upload size={12} />
            {showImport ? "Fechar importação" : "Importar em massa"}
          </button>

          {showImport && (
            <div className="bg-[#f5f5f3] border border-gray-200 rounded-2xl p-4 mb-4 flex flex-col gap-3">
              <textarea
                value={importTexto}
                onChange={(e) => setImportTexto(e.target.value)}
                rows={5}
                placeholder={"Um contato por linha: Nome;Telefone;Lista\nEx: João Silva;17999990000;A"}
                className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition resize-y"
              />
              <div className="flex items-center gap-3">
                <button onClick={handleImportar} disabled={importando} className={btnPrimario}>
                  {importando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Importar
                </button>
                {importResultado && (
                  <p className="text-[11px] font-bold text-green-600">{importResultado}</p>
                )}
              </div>
              <p className="text-[9px] text-gray-400">
                Lista é opcional (padrão A). Separadores aceitos: ponto e vírgula, vírgula ou TAB.
              </p>
            </div>
          )}

          {/* Chips por lista + busca */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {LISTAS.map((l) => (
              <button
                key={l}
                onClick={() => setFiltroLista((f) => (f === l ? "" : l))}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                  filtroLista === l
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                }`}
              >
                Lista {l} · {contagem[l]}
              </button>
            ))}
            <div className="flex items-center gap-2 bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-1.5 ml-auto">
              <Search size={12} className="text-gray-400" />
              <input
                type="text"
                value={buscaNome}
                onChange={(e) => setBuscaNome(e.target.value)}
                placeholder="Buscar por nome"
                className="bg-transparent text-xs text-gray-900 placeholder-gray-400 focus:outline-none w-32"
              />
            </div>
          </div>

          {/* Lista de contatos */}
          {carregandoContatos ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-gray-300" size={20} />
            </div>
          ) : contatosFiltrados.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              {contatos.length === 0
                ? "Nenhum contato ainda — adicione acima ou importe em massa."
                : "Nenhum contato encontrado com esse filtro."}
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {contatosFiltrados.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0 ${badgeLista[c.lista]}`}
                  >
                    {c.lista}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{c.nome}</p>
                    <p className="text-[11px] text-gray-400">{formatTelefone(c.telefone)}</p>
                  </div>
                  <button
                    onClick={() => handleExcluir(c)}
                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    title="Excluir contato"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ══ Card 2 — Disparo ═══════════════════════════════════════════════ */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Disparo
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Escolha um carro do estoque e envie o anúncio para as suas listas.
          </p>

          <button
            onClick={abrirModalEstoque}
            className="w-full py-5 bg-gray-900 text-white rounded-2xl font-black uppercase text-[12px] tracking-widest hover:bg-green-600 transition-all mb-5"
          >
            📦 Estoque — escolher carro
          </button>

          {veiculoSelecionado && (
            <div className="flex items-center gap-4 bg-[#f5f5f3] border border-gray-200 rounded-2xl p-4 mb-5">
              <div className="w-24 h-16 flex-shrink-0 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center">
                {fotoDe(veiculoSelecionado) ? (
                  <img
                    src={fotoDe(veiculoSelecionado)!}
                    alt={`${veiculoSelecionado.marca} ${veiculoSelecionado.modelo}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Car size={20} className="text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black uppercase italic text-gray-900 truncate">
                  {veiculoSelecionado.marca} {veiculoSelecionado.modelo}
                </p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  {veiculoSelecionado.ano_modelo ?? "—"} · {fmtPreco(veiculoSelecionado.preco_sugerido)}
                </p>
              </div>
              <button
                onClick={() => setVeiculoSelecionado(null)}
                className="p-2 text-gray-300 hover:text-red-500 rounded-xl transition-all"
                title="Remover seleção"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5 mb-5">
            <span className={labelCls}>Enviar para as listas</span>
            <div className="flex flex-wrap gap-3">
              {LISTAS.map((l) => (
                <label
                  key={l}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-all text-sm font-bold ${
                    listasSelecionadas.includes(l)
                      ? "border-green-500 bg-green-50 text-gray-900"
                      : "border-gray-200 bg-[#f5f5f3] text-gray-500 hover:border-gray-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={listasSelecionadas.includes(l)}
                    onChange={() => toggleListaDisparo(l)}
                    className="accent-green-600"
                  />
                  Lista {l}
                  <span className="text-[10px] font-black text-gray-400">({contagem[l]})</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleDisparar}
            disabled={!veiculoSelecionado || listasSelecionadas.length === 0 || disparando}
            className={`${btnPrimario} w-full py-4`}
          >
            {disparando && <Loader2 size={14} className="animate-spin" />}
            🚀 Disparar{totalDisparo > 0 ? ` para ${totalDisparo} contatos` : ""}
          </button>
        </div>

        {/* ══ Card 3 — Campanhas ═════════════════════════════════════════════ */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">
              Campanhas
            </h2>
            <button
              onClick={carregarCampanhas}
              disabled={carregandoCampanhas}
              className="p-2 text-gray-300 hover:text-gray-700 rounded-xl transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={carregandoCampanhas ? "animate-spin" : ""} />
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-6">
            Acompanhe o progresso dos seus disparos.
          </p>

          {campanhas.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Nenhuma campanha ainda — faça o primeiro disparo acima.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {campanhas.map((c) => {
                const pct = c.total > 0 ? Math.min(100, Math.round((c.enviados / c.total) * 100)) : 0;
                return (
                  <div key={c.id} className="border border-gray-100 rounded-2xl p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-sm font-black uppercase italic text-gray-900 flex-1 min-w-0 truncate">
                        {c.veiculo
                          ? `${c.veiculo.marca} ${c.veiculo.modelo}${c.veiculo.ano_modelo ? ` ${c.veiculo.ano_modelo}` : ""}`
                          : "Veículo removido"}
                      </p>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${badgeStatus[c.status]}`}
                      >
                        {labelStatus[c.status]}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                      Listas {c.listas.join(", ")} ·{" "}
                      {new Date(c.criado_em).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </p>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-gray-500">
                        {c.enviados}/{c.total} enviados
                        {c.erros > 0 && <span className="text-red-500"> · {c.erros} erros</span>}
                      </p>
                      <div className="flex gap-2">
                        {c.status === "ativa" && (
                          <button
                            onClick={() => acaoCampanha(c.id, "pausar")}
                            className="px-3 py-1.5 bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-amber-200 transition-all"
                          >
                            Pausar
                          </button>
                        )}
                        {c.status === "pausada" && (
                          <>
                            <button
                              onClick={() => acaoCampanha(c.id, "retomar")}
                              className="px-3 py-1.5 bg-green-100 text-green-700 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-green-200 transition-all"
                            >
                              Retomar
                            </button>
                            <button
                              onClick={() => acaoCampanha(c.id, "cancelar")}
                              className="px-3 py-1.5 bg-red-100 text-red-600 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-red-200 transition-all"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[9px] text-gray-400 mt-4">
            Envios saem aos poucos (cadência anti-bloqueio), respeitando a janela e o limite diário
            configurados abaixo.
          </p>
        </div>

        {/* ══ Card 4 — Configuração do canal ═════════════════════════════════ */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Configuração do canal
          </h2>
          <p className="text-[11px] text-gray-500 mb-6">
            Instância Avisa dedicada aos disparos de prospecção.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6">
            <p className="text-[11px] font-bold text-amber-800">
              ⚠️ Use uma instância Avisa SEPARADA do agente de atendimento. Nunca o mesmo chip.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>URL da instância</label>
              <input
                type="text"
                value={canal.baseUrl}
                onChange={(e) => setCanal((c) => ({ ...c, baseUrl: e.target.value }))}
                placeholder="https://www.avisaapi.com.br/api"
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Token</label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={canal.token}
                  onChange={(e) => setCanal((c) => ({ ...c, token: e.target.value }))}
                  placeholder="Token da instância dedicada"
                  className={`${inputCls} w-full pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                  title={showToken ? "Ocultar token" : "Mostrar token"}
                >
                  {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelCls}>Limite por dia</label>
                <select
                  value={canal.capDia}
                  onChange={(e) => setCanal((c) => ({ ...c, capDia: Number(e.target.value) }))}
                  className={inputCls}
                >
                  {[50, 100, 150, 200, 300].map((n) => (
                    <option key={n} value={n}>{n} envios/dia</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelCls}>Janela início</label>
                <select
                  value={canal.janelaInicio}
                  onChange={(e) => setCanal((c) => ({ ...c, janelaInicio: Number(e.target.value) }))}
                  className={inputCls}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}h</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelCls}>Janela fim</label>
                <select
                  value={canal.janelaFim}
                  onChange={(e) => setCanal((c) => ({ ...c, janelaFim: Number(e.target.value) }))}
                  className={inputCls}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}h</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleSalvarCanal}
              disabled={salvandoCanal}
              className={`${btnPrimario} self-start ${salvoCanal ? "!bg-green-600" : ""}`}
            >
              {salvandoCanal ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {salvoCanal ? "Salvo!" : "Salvar configuração"}
            </button>

            <p className="text-[9px] text-gray-400">
              Nos primeiros 7 dias o sistema limita a 50 envios/dia automaticamente (aquecimento do chip).
            </p>
          </div>
        </div>

        {/* ══ Card 5 — Senha de acesso ══════════════════════════════════════ */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">
            Senha de acesso
          </h2>
          <p className="text-[11px] text-gray-500 mb-5">
            Pede esta senha ao abrir a Prospecção pela barra lateral. Deixe em branco para não pedir senha.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Senha</label>
              <input
                type="text"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                placeholder="Sem senha"
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
            </div>
            <button
              onClick={handleSalvarSenha}
              disabled={salvandoSenha}
              className={`${btnPrimario} self-start ${salvoSenha ? "!bg-green-600" : ""}`}
            >
              {salvandoSenha ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {salvoSenha ? "Salvo!" : "Salvar senha"}
            </button>
          </div>
        </div>
      </div>

      {/* ══ Modal Estoque ════════════════════════════════════════════════════ */}
      {modalAberto && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setModalAberto(false)}
        >
          <div
            className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-500">
                Escolher carro do estoque
              </h3>
              <button
                onClick={() => setModalAberto(false)}
                className="p-2 text-gray-300 hover:text-gray-700 rounded-xl transition-all"
                title="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {carregandoVeiculos ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-gray-300" size={24} />
                </div>
              ) : veiculos.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-10">
                  Nenhum carro disponível no estoque.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {veiculos.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setVeiculoSelecionado(v)}
                      className={`text-left rounded-2xl border-2 p-2 transition-all ${
                        veiculoSelecionado?.id === v.id
                          ? "border-green-500 bg-green-50/50"
                          : "border-gray-100 hover:border-gray-300"
                      }`}
                    >
                      {fotoDe(v) ? (
                        <img
                          src={fotoDe(v)!}
                          alt={`${v.marca} ${v.modelo}`}
                          className="w-full aspect-video object-cover rounded-lg bg-gray-100"
                        />
                      ) : (
                        <div className="w-full aspect-video rounded-lg bg-gray-100 flex items-center justify-center">
                          <Car size={22} className="text-gray-300" />
                        </div>
                      )}
                      <p className="mt-2 text-[11px] font-black uppercase italic text-gray-900 leading-tight truncate">
                        {v.marca} {v.modelo}
                      </p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                        {v.ano_modelo ?? "—"}
                      </p>
                      <p className="text-[11px] font-black text-slate-900 tracking-tighter">
                        {fmtPreco(v.preco_sugerido)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {veiculoSelecionado
                  ? `${veiculoSelecionado.marca} ${veiculoSelecionado.modelo} selecionado`
                  : "Clique em um carro para selecionar"}
              </p>
              <button
                onClick={() => setModalAberto(false)}
                disabled={!veiculoSelecionado}
                className={btnPrimario}
              >
                Usar este carro
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
