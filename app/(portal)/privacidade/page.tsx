export const metadata = {
  title: "Política de Privacidade — AutoZap",
  description: "Como a AutoZap coleta, usa e protege seus dados.",
};

export default function PrivacidadePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-20 text-gray-300">
      <h1 className="text-4xl font-bold text-white mb-2">Política de Privacidade</h1>
      <p className="text-sm text-gray-500 mb-10">Última atualização: 24 de abril de 2026</p>

      <Section title="1. Quem somos">
        <p>
          A <strong className="text-white">AutoZap</strong> (LS Tecnologias) é uma plataforma SaaS voltada
          para concessionárias e revendas de veículos. Operamos em{" "}
          <a href="https://autozap.digital" className="text-blue-400 underline">autozap.digital</a>.
        </p>
      </Section>

      <Section title="2. Dados coletados">
        <ul className="list-disc pl-5 space-y-1">
          <li>Nome, e-mail e senha da conta (autenticação via Supabase).</li>
          <li>Dados de veículos, leads e relatórios financeiros inseridos pelo usuário.</li>
          <li>
            Credenciais de integração (WhatsApp Business API, Meta): armazenadas criptografadas e
            usadas exclusivamente para enviar mensagens em nome do tenant.
          </li>
          <li>Logs de acesso (IP, user-agent) para fins de segurança e auditoria.</li>
        </ul>
      </Section>

      <Section title="3. Como usamos os dados">
        <ul className="list-disc pl-5 space-y-1">
          <li>Prestar e melhorar os serviços da plataforma.</li>
          <li>Enviar notificações operacionais (sem fins de marketing não solicitado).</li>
          <li>Cumprir obrigações legais e regulatórias.</li>
        </ul>
      </Section>

      <Section title="4. Compartilhamento">
        <p>
          Não vendemos nem alugamos seus dados. Compartilhamos apenas com provedores técnicos
          essenciais (Supabase, Vercel, Cloudflare, Meta Platforms) sob acordos de
          processamento de dados adequados.
        </p>
      </Section>

      <Section title="5. Retenção">
        <p>
          Dados de conta são mantidos enquanto a assinatura estiver ativa e por até 90 dias após
          o cancelamento, salvo obrigação legal de retenção maior.
        </p>
      </Section>

      <Section title="6. Seus direitos (LGPD)">
        <ul className="list-disc pl-5 space-y-1">
          <li>Acesso, correção ou exclusão dos seus dados pessoais.</li>
          <li>Portabilidade dos dados.</li>
          <li>Revogação do consentimento a qualquer momento.</li>
        </ul>
        <p className="mt-2">
          Para exercer esses direitos, entre em contato:{" "}
          <a href="mailto:lsallesforce@gmail.com" className="text-blue-400 underline">
            lsallesforce@gmail.com
          </a>
        </p>
      </Section>

      <Section title="7. Integração com Meta (Facebook / WhatsApp)">
        <p>
          Quando o usuário conecta sua conta WhatsApp Business via Meta Embedded Signup, coletamos
          o <em>access token</em>, <em>WABA ID</em> e <em>Phone Number ID</em> fornecidos pela
          Meta. Esses dados são usados exclusivamente para enviar e receber mensagens em nome do
          tenant. O usuário pode revogar o acesso a qualquer momento em{" "}
          <strong className="text-white">Configurações → Integração Meta</strong>.
        </p>
        <p className="mt-2">
          Atendemos às solicitações de exclusão de dados da Meta conforme exigido pela plataforma
          (endpoint <code>/api/auth/meta/delete</code>).
        </p>
      </Section>

      <Section title="8. Cookies">
        <p>
          Usamos cookies de sessão estritamente necessários para autenticação. Não usamos cookies
          de rastreamento de terceiros para fins publicitários.
        </p>
      </Section>

      <Section title="9. Segurança">
        <p>
          Adotamos criptografia em trânsito (TLS 1.2+) e em repouso, controle de acesso por
          tenant (row-level security no Supabase) e revisões periódicas de segurança.
        </p>
      </Section>

      <Section title="10. Alterações nesta política">
        <p>
          Notificaremos usuários ativos por e-mail com pelo menos 15 dias de antecedência em caso
          de mudanças materiais.
        </p>
      </Section>

      <Section title="11. Contato">
        <p>
          LS Tecnologias — AutoZap
          <br />
          E-mail:{" "}
          <a href="mailto:lsallesforce@gmail.com" className="text-blue-400 underline">
            lsallesforce@gmail.com
          </a>
          <br />
          Site: <a href="https://autozap.digital" className="text-blue-400 underline">autozap.digital</a>
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold text-white mb-3">{title}</h2>
      <div className="text-gray-400 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
