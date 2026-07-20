// Página exibida quando a assinatura do tenant está inativa (serviço pausado /
// falta de pagamento). Renderiza no lugar do estoque — não vaza nenhum carro.
// Standalone e neutra: funciona também no domínio próprio do tenant.

export default function VitrineIndisponivel({ nomeEmpresa }: { nomeEmpresa?: string | null }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#0b0f17",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 440 }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>🔧</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>
          {nomeEmpresa ? nomeEmpresa : "Vitrine"} temporariamente indisponível
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: "#9ca3af", margin: 0 }}>
          Esta vitrine está fora do ar no momento. Se você é o responsável pela loja,
          regularize sua assinatura para reativá-la.
        </p>
      </div>
    </main>
  );
}
