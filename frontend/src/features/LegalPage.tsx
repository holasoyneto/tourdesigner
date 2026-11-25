import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Locale } from '../types';

interface Props {
  doc: 'privacy' | 'terms';
  locale: Locale;
  onLocale: (l: Locale) => void;
  onNavigate: (path: string) => void;
}

interface LegalMeta {
  operator_name: string;
  contact_email: string;
  operator_address: string;
  effective_date: string;
  tenancy_mode: string;
  hosted_plan: string;
  hosted_ai_daily_limit: number;
  hosted_max_gigs: number;
  hosted_max_files_mb: number;
}

export function LegalPage({ doc, locale, onLocale, onNavigate }: Props) {
  const fr = locale === 'fr';
  const [meta, setMeta] = useState<LegalMeta>({
    operator_name: 'Tour Designer',
    contact_email: 'privacy@example.com',
    operator_address: 'United States & Mexico',
    effective_date: '2026-11-25',
    tenancy_mode: 'multi',
    hosted_plan: 'Free Beta',
    hosted_ai_daily_limit: 25,
    hosted_max_gigs: 200,
    hosted_max_files_mb: 250,
  });

  useEffect(() => {
    void api.legalInfo().then(setMeta).catch(() => undefined);
  }, []);

  return (
    <div
      className="dk-root"
      style={{ display: 'block', height: 'auto', minHeight: '100dvh', overflowY: 'auto', padding: '20px 16px' }}
    >
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
        <div className="dk-tabrow">
          <div className="ytab" style={{ margin: '0 0 -1px -1px' }}>
            <button type="button" className="box" onClick={() => onNavigate(meta.tenancy_mode === 'multi' ? '/' : '/login')} title={fr ? 'Retour' : 'Back'} />
            <span>
              {doc === 'privacy'
                ? fr
                  ? 'Avis de confidentialité (US CCPA & Mexique LFPDPPP)'
                  : 'Privacy Notice (US CCPA/CPRA & Mexico LFPDPPP)'
                : fr
                  ? 'Conditions d’utilisation'
                  : 'Terms of Service'}
            </span>
          </div>
          <div className="flex items-center gap-1.5" style={{ marginLeft: 'auto', paddingBottom: 4 }}>
            <button
              type="button"
              className={`btn${doc === 'privacy' ? ' dk-sect--on' : ''}`}
              onClick={() => onNavigate('/legal/privacy')}
            >
              {fr ? 'Confidentialité' : 'Privacy'}
            </button>
            <button
              type="button"
              className={`btn${doc === 'terms' ? ' dk-sect--on' : ''}`}
              onClick={() => onNavigate('/legal/terms')}
            >
              {fr ? 'Conditions' : 'Terms'}
            </button>
            <button type="button" className="btn mono" onClick={() => onLocale(fr ? 'en' : 'fr')}>
              {fr ? 'EN' : 'FR'}
            </button>
            <button type="button" className="btn btn--def" onClick={() => onNavigate(meta.tenancy_mode === 'multi' ? '/' : '/login')}>
              {fr ? 'Retour' : 'Back'}
            </button>
          </div>
        </div>

        <article className="win space-y-4 p-5 text-sm leading-relaxed">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--cv-line)] pb-3">
            <div>
              <h1 className="m-0 text-base font-bold">
                {doc === 'privacy'
                  ? fr
                    ? 'Avis de confidentialité intégral (LFPDPPP / CCPA-CPRA)'
                    : 'Privacy Notice & Aviso de Privacidad Integral (US & Mexico)'
                  : fr
                    ? 'Conditions générales d’utilisation — Tour Designer'
                    : 'Terms of Service — Tour Designer'}
              </h1>
              <div className="mono sub mt-1 text-xs">
                {fr ? 'Responsable :' : 'Controller / Operator:'} {meta.operator_name} · {meta.operator_address} ·{' '}
                {meta.contact_email}
              </div>
            </div>
            <span className="mono sub text-xs">
              {fr ? 'En vigueur :' : 'Effective:'} {meta.effective_date}
            </span>
          </div>

          {doc === 'privacy' ? (
            <>
              <section className="space-y-1.5">
                <h2 className="lab">1. Identity of Data Controller & Scope (Mexico LFPDPPP & US CCPA/CPRA)</h2>
                <p className="m-0">
                  <strong>{meta.operator_name}</strong> ({meta.operator_address}; contact:{' '}
                  <a href={`mailto:${meta.contact_email}`}>{meta.contact_email}</a>) acts as the data controller (
                  <em>Responsable del Tratamiento</em>) for personal information processed through the hosted Tour Designer
                  application in accordance with Mexico’s <em>Ley Federal de Protección de Datos Personales en Posesión de los
                  Particulares</em> (LFPDPPP) and applicable United States privacy laws, including the California Consumer Privacy
                  Act as amended by the CPRA (CCPA/CPRA).
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">2. Categories of Data Processed & Primary Purposes</h2>
                <ul className="m-0 list-disc space-y-1 pl-5">
                  <li>
                    <strong>Account Identity (Google Sign-In):</strong> Verified Google email address, display name, and unique
                    Google subject identifier (<code>openid</code>, <code>email</code>, <code>profile</code> scopes only) used
                    strictly to authenticate you and provision your physically isolated workspace.
                  </li>
                  <li>
                    <strong>Tour Logistics & Crew Contacts:</strong> Schedules, flight/hotel confirmations, venue contacts, crew
                    rosters, notes, and documents you choose to upload or share. You control all records in your workspace.
                  </li>
                  <li>
                    <strong>Optional AI Extraction:</strong> When you click <em>Analyze</em> in AI Intake with Google AI enabled,
                    the text you paste is sent to Google Cloud Vertex AI / Gemini strictly to return structured itinerary rows. You
                    may opt out at any time by switching AI Intake to <strong>Local (offline)</strong> in Settings.
                  </li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">3. No Sale of Personal Data · Zero Tracking Cookies · Google API Limited Use</h2>
                <p className="m-0">
                  We <strong>do not sell</strong> or share your personal information for cross-context behavioral advertising (as
                  defined under CCPA/CPRA). We use <strong>only strictly necessary HttpOnly session and CSRF cookies</strong> — no
                  ad pixels or third-party tracking cookies. Our use of information received from Google APIs strictly adheres to
                  the <strong>Google API Services User Data Policy</strong>, including the Limited Use requirements.
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">4. Infrastructure Sub-Processors & International Transfers</h2>
                <p className="m-0">
                  Hosted workspaces run on <strong>Google Cloud Platform</strong> (Cloud Run, Cloud Firestore, Cloud Storage, and
                  optional Vertex AI / Gemini API) with encryption in transit (TLS) and at rest. By creating a hosted workspace,
                  you consent to cross-border cloud storage necessary to operate the service (LFPDPPP Art. 36).
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">5. Your ARCO (Mexico), CCPA/CPRA (US) &amp; EU/UK GDPR Rights</h2>
                <p className="m-0">
                  Hosted cloud data is stored in Google Cloud <code>europe-west1</code> (Belgium, EU) with logical and storage
                  isolation per tenant. Under EU/UK GDPR (Articles 15, 16, 17, 18, and 20), Mexico LFPDPPP (ARCO), and US
                  CCPA/CPRA, you have the right to <strong>Access / Export</strong> (JSON portability),{' '}
                  <strong>Rectify</strong>, <strong>Erase</strong>, and <strong>Object / Opt Out</strong> without discrimination:
                </p>
                <ul className="m-0 list-disc space-y-1 pl-5">
                  <li>
                    <strong>Instant Self-Service in Settings:</strong> Export your complete workspace as JSON (
                    <code>Download my data</code>), switch AI Intake to offline <code>Local</code> mode, or permanently erase your
                    entire workspace and files (<code>Delete workspace &amp; all data</code>).
                  </li>
                  <li>
                    <strong>Direct Privacy Contact:</strong> Email <a href={`mailto:${meta.contact_email}`}>{meta.contact_email}</a>{' '}
                    with your account email and request; we respond within statutory LFPDPPP (20 business days) and CCPA (45 days)
                    timelines.
                  </li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">6. Children’s Privacy (COPPA)</h2>
                <p className="m-0">
                  Tour Designer is a professional touring workspace intended exclusively for individuals aged <strong>18 or
                  older</strong>. We do not knowingly collect personal data from children under 13 (or 18).
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="space-y-1.5">
                <h2 className="lab">1. Eligibility & Account Isolation</h2>
                <p className="m-0">
                  By signing up or using the hosted Tour Designer service operated by <strong>{meta.operator_name}</strong>, you
                  confirm that you are at least <strong>18 years old</strong> and authorized to manage the tour data and crew
                  contacts you upload. Each Google account receives a logically and storage-isolated workspace; you are responsible
                  for the team login keys, MCP keys, and public share links you issue.
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">2. Free Beta & Fair-Use Quotas (Transparent Pricing Notice)</h2>
                <p className="m-0">
                  The hosted service ({meta.hosted_plan}) currently includes cloud storage and Google Gemini AI extraction at{' '}
                  <strong>$0 cost</strong> subject to fair-use limits (currently up to {meta.hosted_ai_daily_limit} hosted AI
                  extractions/day, {meta.hosted_max_gigs} dates, and {meta.hosted_max_files_mb} MB file vault per workspace). We
                  will provide clear advance notice before introducing any paid subscription tiers, and you may export your complete
                  workspace data as JSON or self-host the open-source <strong>AGPL-3.0-only</strong> codebase at any time with
                  zero lock-in. Commercial or white-label licenses are available separately upon request.
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">3. Ownership of Your Data & Acceptable Use</h2>
                <p className="m-0">
                  You retain <strong>100% ownership</strong> of all itineraries, contacts, contracts, and files you place in Tour
                  Designer. You agree not to abuse quotas, attempt unauthorized access to other workspaces, upload malware or
                  unlawful material, or violate applicable United States or Mexican law.
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">4. Copyright / DMCA & Contact</h2>
                <p className="m-0">
                  To submit a DMCA takedown notice or legal inquiry under US or Mexican law, contact{' '}
                  <a href={`mailto:${meta.contact_email}`}>{meta.contact_email}</a>.
                </p>
              </section>

              <section className="space-y-1.5">
                <h2 className="lab">5. Disclaimer & Limitation of Liability</h2>
                <p className="m-0">
                  The service is provided <strong>“AS IS”</strong> and <strong>“AS AVAILABLE”</strong> without warranties of any
                  kind. Always verify critical flight times, confirmation numbers, and contractual terms independently. To the
                  maximum extent permitted by applicable US and Mexican law, {meta.operator_name} is not liable for indirect,
                  incidental, or consequential damages resulting from missed flights, scheduling errors, or service interruptions.
                </p>
              </section>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
