export const metadata = {
  title: "Termos de Serviço — AutoZap",
  description: "Termos e condições de uso da plataforma AutoZap.",
};

export default function TermosPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-20 text-gray-300">
      <h1 className="text-4xl font-bold text-white mb-2">Termos de Serviço</h1>
      <p className="text-sm text-gray-500 mb-10">Última atualização: 24 de abril de 2026</p>

      <Section title="1. Aceitação">
        <p>
          Ao criar uma conta na <strong className="text-white">AutoZap</strong> (LS Tecnologias),
          você concorda com estes Termos de Serviço e com nossa{" "}
          <a href="/privacidade" className="text-blue-400 underline">
            Política de Privacidade
          </a>
          .
        </p>
      </Section>

      <Section title="2. Descrição do serviço">
        <p>
          AutoZap é uma plataforma SaaS de gestão para revendas de veículos, com funcionalidades
          de atendimento via WhatsApp, geração de vídeos de marketing, vitrine digital e
          relatórios financeiros.
        </p>
      </Section>

      <Section title="3. Cadastro e responsabilidades">
        <ul className="list-disc pl-5 space-y-1">
          <li>Você é responsável pela veracidade das informações cadastradas.</li>
          <li>Mantenha sua senha em sigilo; qualquer acesso com suas credenciais é de sua responsabilidade.</li>
          <li>É proibido usar a plataforma para enviar spam ou conteúdo ilegal.</li>
        </ul>
      </Section>

      <Section title="4. Uso aceitável">
        <p>Você concorda em não:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Violar as Políticas de Uso do WhatsApp Business ou da Meta Platforms.</li>
          <li>Enviar mensagens não solicitadas em massa (spam).</li>
          <li>Tentar acessar dados de outros tenants.</li>
          <li>Fazer engenharia reversa ou copiar a plataforma.</li>
        </ul>
      </Section>

      <Section title="5. Planos e pagamento">
        <p>
          Os planos e preços estão descritos em{" "}
          <a href="/planos" className="text-blue-400 underline">/planos</a>. O
          pagamento é mensal e antecipado. A falta de pagamento suspende o acesso após 7 dias de
          atraso. Não há reembolso de períodos já pagos, salvo garantia legal de 7 dias para
          novas assinaturas.
        </p>
      </Section>

      <Section title="6. Disponibilidade">
        <p>
          Buscamos 99,5% de uptime, mas não garantimos disponibilidade ininterrupta. Manutenções
          programadas serão comunicadas com antecedência.
        </p>
      </Section>

      <Section title="7. Propriedade intelectual">
        <p>
          O código, design e marca AutoZap são propriedade da LS Tecnologias. Os dados inseridos
          pelo usuário (veículos, leads, etc.) permanecem de sua propriedade.
        </p>
      </Section>

      <Section title="8. Rescisão">
        <p>
          Você pode cancelar a qualquer momento pelo painel. Reservamo-nos o direito de suspender
          contas que violem estes Termos.
        </p>
      </Section>

      <Section title="9. Limitação de responsabilidade">
        <p>
          A AutoZap não se responsabiliza por danos indiretos, lucros cessantes ou perda de dados
          decorrentes do uso ou impossibilidade de uso da plataforma, na extensão máxima
          permitida pela legislação brasileira.
        </p>
      </Section>

      <Section title="10. Lei aplicável">
        <p>
          Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da comarca de
          São Paulo/SP para dirimir eventuais controvérsias.
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
