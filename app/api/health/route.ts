// app/api/health/route.ts
//
// Health Check — Fase 2 Hardening
//
// GET /api/health
//
// Verifica o estado das 3 dependências críticas do sistema:
//   - Redis (Upstash)  → deduplicação + cache de histórico
//   - Supabase         → leads, estoque, config, mensagens
//   - Avisa API        → envio/recebimento de mensagens WhatsApp
//
// Status agregado:
//   "ok"       → todos os serviços saudáveis
//   "degraded" → Avisa com problema (sistema funciona, mensagens podem atrasar)
//   "error"    → Redis ou Supabase down (sistema não pode operar corretamente)
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

// ─── Checagem Individual com Timeout ────────────────────────────────────────

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
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: e.message ?? "unknown",
    };
  }
}

async function checkSupabase(): Promise<ServiceResult> {
  const start = Date.now();
  try {
    const { error } = await supabaseAdmin
      .from("config_garage")
      .select("user_id")
      .limit(1);
    return {
      status: error ? "error" : "ok",
      latency_ms: Date.now() - start,
      ...(error ? { error: error.message } : {}),
    };
  } catch (e: any) {
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: e.message ?? "unknown",
    };
  }
}

async function checkAvisa(): Promise<ServiceResult> {
  const start = Date.now();
  const baseUrl = process.env.AVISA_BASE_URL ?? "https://www.avisaapi.com.br/api";

  try {
    const resp = await fetch(baseUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "AutoZap-HealthCheck/2.0" },
    });

    // Qualquer resposta HTTP (mesmo 401/405) indica que o servidor está de pé
    const isUp = resp.status < 500;
    return {
      status: isUp ? "ok" : "degraded",
      latency_ms: Date.now() - start,
      ...(!isUp ? { error: `HTTP ${resp.status}` } : {}),
    };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    return {
      // Avisa down = degraded, não error — sistema ainda lê mensagens do webhook
      status: "degraded",
      latency_ms: Date.now() - start,
      error: isTimeout ? "timeout (4s)" : (e.message ?? "unknown"),
    };
  }
}

// ─── Rota Principal ───────────────────────────────────────────────────────────

export async function GET() {
  // Executa todas as checagens em paralelo para minimizar latência total
  const [redisResult, supabaseResult, avisaResult] = await Promise.all([
    checkRedis(),
    checkSupabase(),
    checkAvisa(),
  ]);

  const services = {
    redis: redisResult,
    supabase: supabaseResult,
    avisa: avisaResult,
  };

  // Redis ou Supabase down = incapaz de operar → "error"
  // Avisa down = envio/recebimento prejudicado → "degraded"
  const criticalDown =
    services.redis.status === "error" || services.supabase.status === "error";

  const anyDegraded = Object.values(services).some((s) => s.status !== "ok");

  const overallStatus: ServiceStatus = criticalDown
    ? "error"
    : anyDegraded
    ? "degraded"
    : "ok";

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      services,
    },
    { status: criticalDown ? 503 : 200 }
  );
}
