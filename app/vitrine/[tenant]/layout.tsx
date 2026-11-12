// Layout da vitrine pública de cada loja. Só existe pra montar o
// OrigemWhatsVitrine (de onde veio quem chama no WhatsApp) em todas as páginas
// da vitrine — home e carro, layout padrão e premium.
import OrigemWhatsVitrine from "@/components/vitrine/OrigemWhatsVitrine";

export default function VitrineTenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <OrigemWhatsVitrine />
    </>
  );
}
