// app/api/meta/debug-token/route.ts
// DIAGNÓSTICO TEMPORÁRIO — apagar depois de resolver o bug do instagram_basic.
import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { getMetaTokens } from "@/lib/meta-tenant";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { adsToken } = await getMetaTokens(userId);
  if (!adsToken) return NextResponse.json({ error: "sem token" });

  const res = await fetch(
    `https://graph.facebook.com/v21.0/debug_token?input_token=${adsToken}&access_token=${adsToken}`
  );
  const data = await res.json();
  return NextResponse.json({ scopes: data.data?.scopes, expires_at: data.data?.expires_at });
}
