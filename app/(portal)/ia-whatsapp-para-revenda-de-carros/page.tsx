import { LandingSolucao, landingMetadata } from "@/components/LandingSolucao";
import { getLanding } from "@/lib/portal/landings";

const landing = getLanding("ia-whatsapp-para-revenda-de-carros");

export const metadata = landingMetadata(landing);

export default function Page() {
  return <LandingSolucao landing={landing} />;
}
