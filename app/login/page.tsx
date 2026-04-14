"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Mode = "login" | "register" | "forgot";

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    {open ? (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </>
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 012.189-3.714M6.53 6.533A9.96 9.96 0 0112 5c4.477 0 8.268 2.943 9.542 7a9.973 9.973 0 01-4.024 5.018M15 12a3 3 0 00-3-3m0 0a3 3 0 00-2.83 2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      </>
    )}
  </svg>
);

function PasswordField({
  label, value, onChange, show, onToggle, placeholder = "••••••••",
}: {
  label: string; value: string; onChange: (v: string) => void;
  show: boolean; onToggle: () => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
          tabIndex={-1}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() {
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirm(false);
  }

  function switchMode(m: Mode) {
    reset();
    setMode(m);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("E-mail ou senha incorretos.");
      setLoading(false);
      return;
    }

    window.location.href = "/";
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message === "User already registered"
        ? "Este e-mail já está cadastrado."
        : error.message);
      return;
    }

    // Envia email de confirmação branded (fire-and-forget)
    fetch("/api/email/confirmacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});

    setSuccess("Conta criada! Verifique seu e-mail para confirmar o cadastro.");
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    setLoading(false);
    if (error) {
      setError("Não foi possível enviar o e-mail. Verifique o endereço.");
      return;
    }

    setSuccess("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
  }

  const titles: Record<Mode, { heading: string; sub: string }> = {
    login:    { heading: "Painel de Controle", sub: "Acesso restrito à equipe autorizada" },
    register: { heading: "Criar Conta",        sub: "Preencha os dados para se cadastrar" },
    forgot:   { heading: "Recuperar Senha",    sub: "Enviaremos um link para seu e-mail" },
  };

  return (
    <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <h1 className="text-4xl font-black tracking-tighter italic">
            <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
          </h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          <div className="mb-6">
            <h2 className="text-[13px] font-black uppercase tracking-[0.2em] text-gray-900">
              {titles[mode].heading}
            </h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {titles[mode].sub}
            </p>
          </div>

          {/* ── LOGIN ── */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">E-mail</label>
                <input
                  type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <PasswordField
                label="Senha" value={password} onChange={setPassword}
                show={showPassword} onToggle={() => setShowPassword(p => !p)}
              />

              <div className="flex justify-end -mt-2">
                <button type="button" onClick={() => switchMode("forgot")}
                  className="text-[10px] text-red-600 hover:text-red-700 font-bold uppercase tracking-widest transition">
                  Esqueci minha senha
                </button>
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={loading}
                className="mt-1 bg-[#CC0000] hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors">
                {loading ? "Verificando..." : "Entrar no Painel"}
              </button>

              <div className="text-center pt-1">
                <span className="text-[10px] text-gray-400">Não tem conta? </span>
                <button type="button" onClick={() => switchMode("register")}
                  className="text-[10px] text-red-600 hover:text-red-700 font-bold uppercase tracking-widest transition">
                  Criar conta
                </button>
              </div>
            </form>
          )}

          {/* ── CADASTRO ── */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">E-mail</label>
                <input
                  type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              <PasswordField
                label="Senha" value={password} onChange={setPassword}
                show={showPassword} onToggle={() => setShowPassword(p => !p)}
                placeholder="Mínimo 6 caracteres"
              />

              <PasswordField
                label="Confirmar Senha" value={confirmPassword} onChange={setConfirmPassword}
                show={showConfirm} onToggle={() => setShowConfirm(p => !p)}
              />

              {error && <ErrorBox message={error} />}
              {success && <SuccessBox message={success} />}

              {!success && (
                <button type="submit" disabled={loading}
                  className="mt-1 bg-[#CC0000] hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors">
                  {loading ? "Criando conta..." : "Criar Conta"}
                </button>
              )}

              <div className="text-center pt-1">
                <span className="text-[10px] text-gray-400">Já tem conta? </span>
                <button type="button" onClick={() => switchMode("login")}
                  className="text-[10px] text-red-600 hover:text-red-700 font-bold uppercase tracking-widest transition">
                  Entrar
                </button>
              </div>
            </form>
          )}

          {/* ── RECUPERAR SENHA ── */}
          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">E-mail</label>
                <input
                  type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                  className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
                />
              </div>

              {error && <ErrorBox message={error} />}
              {success && <SuccessBox message={success} />}

              {!success && (
                <button type="submit" disabled={loading}
                  className="mt-1 bg-[#CC0000] hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors">
                  {loading ? "Enviando..." : "Enviar Link de Recuperação"}
                </button>
              )}

              <div className="text-center pt-1">
                <button type="button" onClick={() => switchMode("login")}
                  className="text-[10px] text-red-600 hover:text-red-700 font-bold uppercase tracking-widest transition">
                  ← Voltar ao login
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-[10px] text-gray-400 mt-6 uppercase tracking-widest">
          AutoZap © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
      <p className="text-red-600 text-[11px] font-bold text-center">{message}</p>
    </div>
  );
}

function SuccessBox({ message }: { message: string }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
      <p className="text-green-700 text-[11px] font-bold text-center">{message}</p>
    </div>
  );
}
