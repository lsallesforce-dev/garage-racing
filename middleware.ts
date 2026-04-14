import { NextRequest, NextResponse } from "next/server";

// Injeta o pathname atual nos headers da REQUEST para que Server Layouts possam lê-lo.
// Necessário para proteger rotas de vendedores no MainLayout.
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png).*)",
  ],
};
