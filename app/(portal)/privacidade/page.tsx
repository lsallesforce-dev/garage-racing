export const metadata = {
  title: "Privacy Policy — AutoZap",
  description: "How AutoZap collects, uses, and protects your data.",
};

export default function PrivacidadePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-20 text-gray-700">
      <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: April 24, 2026</p>

      <Section title="1. Who we are">
        <p>
          <strong className="text-gray-900">AutoZap</strong> (LS Tecnologias) is a SaaS platform for
          car dealerships and used-car resellers. We operate at{" "}
          <a href="https://autozap.digital" className="text-blue-600 underline">autozap.digital</a>.
        </p>
      </Section>

      <Section title="2. Data we collect">
        <ul className="list-disc pl-5 space-y-1">
          <li>Account name, email address, and password (authentication via Supabase).</li>
          <li>Vehicle listings, lead records, and financial reports entered by the user.</li>
          <li>
            Integration credentials (WhatsApp Business API, Meta): stored encrypted and used
            exclusively to send messages on behalf of the tenant account.
          </li>
          <li>Access logs (IP address, user-agent) for security and audit purposes.</li>
        </ul>
      </Section>

      <Section title="3. How we use your data">
        <ul className="list-disc pl-5 space-y-1">
          <li>To provide and improve the platform&apos;s services.</li>
          <li>To send operational notifications (no unsolicited marketing).</li>
          <li>To comply with legal and regulatory obligations.</li>
        </ul>
      </Section>

      <Section title="4. Data sharing">
        <p>
          We do not sell or rent your data. We share data only with essential technical sub-processors
          (Supabase, Vercel, Cloudflare, Meta Platforms) under appropriate data processing agreements.
        </p>
      </Section>

      <Section title="5. Retention">
        <p>
          Account data is retained while the subscription is active and for up to 90 days after
          cancellation, unless a longer retention period is required by law.
        </p>
      </Section>

      <Section title="6. Your rights">
        <ul className="list-disc pl-5 space-y-1">
          <li>Access, correction, or deletion of your personal data.</li>
          <li>Data portability.</li>
          <li>Withdrawal of consent at any time.</li>
        </ul>
        <p className="mt-2">
          To exercise these rights, contact us at:{" "}
          <a href="mailto:contato@autozap.digital" className="text-blue-600 underline">
            contato@autozap.digital
          </a>
        </p>
      </Section>

      <Section title="7. Meta (Facebook / WhatsApp) integration">
        <p>
          When a user connects their WhatsApp Business account or uses Meta Lead Ads, we receive and
          store lead data (name, phone number, email, and ad context) provided by Meta through the
          Leads Retrieval API and WhatsApp Business API. This data is used exclusively to notify the
          tenant and enable follow-up with the prospective customer.
        </p>
        <p className="mt-2">
          Users can revoke access at any time in{" "}
          <strong className="text-gray-900">Settings → Meta Integration</strong>.
        </p>
        <p className="mt-2">
          <strong className="text-gray-900">Data Deletion:</strong> If you want to delete all data
          we received from Meta, you can:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li>
            Request deletion via email:{" "}
            <a href="mailto:contato@autozap.digital" className="text-blue-600 underline">
              contato@autozap.digital
            </a>
          </li>
          <li>
            Or use Meta&apos;s data deletion callback:{" "}
            <a href="https://app.autozap.digital/api/auth/meta/delete" className="text-blue-600 underline">
              app.autozap.digital/api/auth/meta/delete
            </a>
          </li>
        </ul>
        <p className="mt-2">
          We comply with Meta&apos;s data deletion requests as required by the platform within 30 days.
        </p>
      </Section>

      <Section title="8. Cookies">
        <p>
          We use strictly necessary session cookies for authentication only. We do not use
          third-party tracking or advertising cookies.
        </p>
      </Section>

      <Section title="9. Security">
        <p>
          We apply encryption in transit (TLS 1.2+) and at rest, per-tenant access control
          (row-level security in Supabase), and periodic security reviews.
        </p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>
          We will notify active users by email at least 15 days in advance of any material changes
          to this policy.
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
        <a href="mailto:contato@autozap.digital" className="text-blue-600 underline">
          contato@autozap.digital
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
