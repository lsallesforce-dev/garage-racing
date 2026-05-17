export const metadata = {
  title: "Terms of Service — AutoZap",
  description: "Terms and conditions for using the AutoZap platform.",
};

export default function TermosPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-20 text-gray-700">
      <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: April 24, 2026</p>

      <Section title="1. Acceptance">
        <p>
          By creating an account on <strong className="text-gray-900">AutoZap</strong> (LS Tecnologias),
          you agree to these Terms of Service and our{" "}
          <a href="/privacidade" className="text-blue-600 underline">
            Privacy Policy
          </a>
          .
        </p>
      </Section>

      <Section title="2. Description of service">
        <p>
          AutoZap is a SaaS management platform for vehicle resellers, offering WhatsApp-based
          lead engagement, AI-generated marketing videos, a digital showroom, and financial reports.
        </p>
      </Section>

      <Section title="3. Registration and responsibilities">
        <ul className="list-disc pl-5 space-y-1">
          <li>You are responsible for the accuracy of the information you provide.</li>
          <li>Keep your password confidential; any access using your credentials is your responsibility.</li>
          <li>Using the platform to send spam or illegal content is strictly prohibited.</li>
        </ul>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Violate WhatsApp Business or Meta Platforms usage policies.</li>
          <li>Send unsolicited bulk messages (spam).</li>
          <li>Attempt to access data belonging to other tenants.</li>
          <li>Reverse-engineer or copy the platform.</li>
        </ul>
      </Section>

      <Section title="5. Plans and payment">
        <p>
          Plans and pricing are described at{" "}
          <a href="/planos" className="text-blue-600 underline">/planos</a>. Payment is monthly and
          due in advance. Non-payment will result in suspended access after 7 days. No refunds are
          issued for periods already paid, except for the 7-day statutory right for new subscriptions.
        </p>
      </Section>

      <Section title="6. Availability">
        <p>
          We target 99.5% uptime but do not guarantee uninterrupted availability. Scheduled
          maintenance will be communicated in advance.
        </p>
      </Section>

      <Section title="7. Intellectual property">
        <p>
          The AutoZap code, design, and brand are the property of LS Tecnologias. Data entered by
          users (vehicles, leads, etc.) remains their property.
        </p>
      </Section>

      <Section title="8. Termination">
        <p>
          You may cancel at any time from the dashboard. We reserve the right to suspend accounts
          that violate these Terms.
        </p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>
          AutoZap is not liable for indirect damages, lost profits, or data loss arising from the
          use or inability to use the platform, to the maximum extent permitted by applicable law.
        </p>
      </Section>

      <Section title="10. Governing law">
        <p>
          These Terms are governed by the laws of Brazil. The courts of São Paulo/SP shall have
          exclusive jurisdiction over any disputes.
        </p>
      </Section>

      <Section title="11. Contact">
        <CompanyFooter />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="text-gray-600 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function CompanyFooter() {
  return (
    <address className="not-italic text-gray-600 leading-relaxed space-y-1">
      <p className="font-semibold text-gray-900">LS Tecnologias LTDA</p>
      <p>CNPJ: 17.505.636/0001-98</p>
      <p>Rua Julio Lopes Gil, 135 — Jardim Tangará — São José do Rio Preto/SP — CEP 15086-090</p>
      <p>
        Email:{" "}
        <a href="mailto:autozap@autozap.digital" className="text-blue-600 underline">
          autozap@autozap.digital
        </a>
      </p>
      <p>
        Website:{" "}
        <a href="https://autozap.digital" className="text-blue-600 underline">
          autozap.digital
        </a>
      </p>
    </address>
  );
}
