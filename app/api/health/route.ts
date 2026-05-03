// app/api/health/route.ts
//
// Health Check — Fase 3 Hardening
//
// GET /api/health
//
// Verifica o estado das dependências críticas do sistema:
//   - Redis (Upstash)  → deduplicação + cache de histórico        [critical]
//   - Supabase         → leads, estoque, config, mensagens         [critical]
//   - Gemini           → geração de respostas da IA               [critical]
//   - R2 (Cloudflare)  → vídeos e fotos de estoque                [degraded]
//   - QStash (Upstash) → fila de jobs de vídeo marketing          [degraded]
//   - Avisa API        → envio/recebimento de mensagens WhatsApp   [degraded]
//
// Status agregado:
//   "ok"       → todos os serviços saudáveis
//   "degraded" → serviço não-crítico com problema
//   "error"    → Redis, Supabase ou Gemini down (sistema inoperante)
//
// HTTP:
//   200 → ok ou degraded
//   503 → error

import { NextResponse } from "next/server";
import { redisPing } from "@/lib/redis";
import { supabaseAdmin } from "@/lib/supabase-admin";

type ServiceStatus = "ok" | "degraded" | "error";

interface ServiceResult {
  status: ServiceStatus;
  latency_ms: number;
  error?: string;
}

// ─── Checagens Individuais com Timeout ───────────────────────────────────────

async function checkRedis(): Promise<ServiceResult> {
  const start = Date.now();
  try {
    const pong = await Promise.race([
      redisPing(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000)
      ),
    ]);
    return {
      status: pong === "PONG" ? "ok" : "degraded",
      latency_ms: Date.now() - start,
    };
  } catch (e: any) {
    return { status: "error", latency_ms: Date.now() - start, error: e.message ?? "unknown" };
  }
}

async function checkSupabase(): Promise<ServiceResult> {
  const start = Date.now();
  try {
    const { error } = await supabaseAdmin.from("config_garage").select("user_id").limit(1);
    return {
      status: error ? "error" : "ok",
      latency_ms: Date.now() - start,
      ...(error ? { error: error.message } : {}),
    };
  } catch (e: any) {
    return { status: "error", latency_ms: Date.now() - start, error: e.message ?? "unknown" };
  }
}

async function checkGemini(): Promise<ServiceResult> {
  const start = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { status: "error", latency_ms: 0, error: "GEMINI_API_KEY não configurado" };
  }
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`,
      { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "AutoZap-HealthCheck/3.0" } }
    );
    if (resp.ok) return { status: "ok", latency_ms: Date.now() - start };
    return { status: "error", latency_ms: Date.now() - start, error: `HTTP ${resp.status}` };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    return { status: "error", latency_ms: Date.now() - start, error: isTimeout ? "timeout (5s)" : (e.message ?? "unknown") };
  }
}

async function checkR2(): Promise<ServiceResult> {
  const start = Date.now();
  const r2Url = process.env.R2_PUBLIC_URL;
  if (!r2Url) {
    return { status: "degraded", latency_ms: 0, error: "R2_PUBLIC_URL não configurado" };
  }
  try {
    const resp = await fetch(r2Url, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "AutoZap-HealthCheck/3.0" },
    });
    // R2 retorna 403 em HEAD na raiz sem path — isso é normal, indica que está de pé
    const isUp = resp.status < 500;
    return {
      status: isUp ? "ok" : "degraded",
      latency_ms: Date.now() - start,
      ...(!isUp ? { error: `HTTP ${resp.status}` } : {}),
    };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    return { status: "degraded", latency_ms: Date.now() - start, error: isTimeout ? "timeout (4s)" : (e.message ?? "unknown") };
  }
}

async function checkQStash(): Promise<ServiceResult> {
  const start = Date.now();
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    return { status: "degraded", latency_ms: 0, error: "QSTASH_TOKEN não configurado" };
  }
  try {
    const resp = await fetch("https://qstash.upstash.io/v2/schedules", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "AutoZap-HealthCheck/3.0" },
      signal: AbortSignal.timeout(4000),
    });
    if (resp.ok) return { status: "ok", latency_ms: Date.now() - start };
    return { status: "degraded", latency_ms: Date.now() - start, error: `HTTP ${resp.status}` };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    return { status: "degraded", latency_ms: Date.now() - start, error: isTimeout ? "timeout (4s)" : (e.message ?? "unknown") };
  }
}

async function checkAvisa(): Promise<ServiceResult> {
  const start = Date.now();
  const baseUrl = process.env.AVISA_BASE_URL ?? "https://www.avisaapi.com.br/api";
  try {
    const resp = await fetch(baseUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "AutoZap-HealthCheck/3.0" },
    });
    const isUp = resp.status < 500;
    return {
      status: isUp ? "ok" : "degraded",
      latency_ms: Date.now() - start,
      ...(!isUp ? { error: `HTTP ${resp.status}` } : {}),
    };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    return { status: "degraded", latency_ms: Date.now() - start, error: isTimeout ? "timeout (4s)" : (e.message ?? "unknown") };
  }
}

// ─── Rota Principal ───────────────────────────────────────────────────────────

export async function GET() {
  const [redisResult, supabaseResult, geminiResult, r2Result, qstashResult, avisaResult] =
    await Promise.all([
      checkRedis(),
      checkSupabase(),
      checkGemini(),
      checkR2(),
      checkQStash(),
      checkAvisa(),
    ]);

  const services = {
    redis: redisResult,
    supabase: supabaseResult,
    gemini: geminiResult,
    r2: r2Result,
    qstash: qstashResult,
    avisa: avisaResult,
  };

  // Redis, Supabase ou Gemini down = sistema inoperante → "error" → HTTP 503
  const criticalDown =
    services.redis.status === "error" ||
    services.supabase.status === "error" ||
    services.gemini.status === "error";

  const anyDegraded = Object.values(services).some((s) => s.status !== "ok");

  const overallStatus: ServiceStatus = criticalDown ? "error" : anyDegraded ? "degraded" : "ok";

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: "3.0.0",
      services,
    },
    { status: criticalDown ? 503 : 200 }
  );
}
