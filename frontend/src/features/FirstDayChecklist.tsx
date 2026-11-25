import type { Locale, User } from '../types';

interface Props {
  user: User;
  locale: Locale;
  hasMcp: boolean;
  gigsCount: number;
  filesCount: number;
  onConnectMcp: () => void;
  onOpenPaste: () => void;
  onOpenFiles: () => void;
  onDismiss: () => void;
}

export function FirstDayChecklist({
  user,
  locale,
  hasMcp,
  gigsCount,
  filesCount,
  onConnectMcp,
  onOpenPaste,
  onOpenFiles,
  onDismiss,
}: Props) {
  const fr = locale === 'fr';
  if (user.role === 'viewer') return null;

  const hasAddedTourData = gigsCount > 0;
  const hasUploadedDoc = filesCount > 0;
  const steps = [
    {
      id: 'mcp',
      done: hasMcp,
      title: fr
        ? 'Installez le MCP dans votre app IA mobile (Claude, ChatGPT, Gemini, Grok)'
        : 'Install MCP in your favorite AI mobile app (Claude, ChatGPT, Gemini, Grok)',
      desc: fr
        ? 'Vous utiliserez surtout l’app depuis votre chat IA : demander vos cartes d’embarquement, importer un mail promoteur et programmer vos rappels.'
        : 'Designed to be used mostly from your AI chat: pull up boarding passes & hotel vouchers, drop promoter emails, and run morning briefings.',
      cta: hasMcp ? (fr ? 'Connecté ✓' : 'Connected ✓') : fr ? 'Connecter mon IA →' : 'Connect AI (MCP) →',
      onAction: onConnectMcp,
    },
    {
      id: 'gig',
      done: hasAddedTourData,
      title: fr ? 'Ajoutez ou collez votre première date' : 'Add or paste your first show',
      desc: fr
        ? 'Collez un mail de booking, un billet d’avion ou un WhatsApp — l’IA structure tout en 1 clic.'
        : 'Paste a booking email, flight confirmation, or WhatsApp thread — AI structures it in 1 tap.',
      cta: hasAddedTourData ? (fr ? 'Fait ✓' : 'Done ✓') : fr ? '✨ Coller / Importer' : '✨ Paste / Import',
      onAction: onOpenPaste,
    },
    {
      id: 'files',
      done: hasUploadedDoc,
      title: fr
        ? 'Déposez une carte d’embarquement, un bon d’hôtel ou un rider'
        : 'Drop a boarding pass, hotel voucher, or rider',
      desc: fr
        ? 'Stockés hors ligne et récupérables instantanément dans le chat de votre assistant IA via MCP.'
        : 'Saved offline in your vault and instantly retrievable right inside your AI chat via MCP.',
      cta: hasUploadedDoc ? (fr ? 'Déposé ✓' : 'Uploaded ✓') : fr ? 'Ouvrir Documents →' : 'Open Files →',
      onAction: onOpenFiles,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div
      className="no-print border-b border-[var(--cv-line2)] bg-[var(--cv-paper2)] px-3 py-2.5 text-xs"
      role="region"
      aria-label={fr ? 'Checklist premier jour' : 'Day 1 quick start'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="mono"
            style={{
              background: 'var(--cv-tab)',
              color: '#1b1600',
              padding: '1px 6px',
              fontSize: 10.5,
              fontWeight: 700,
              border: '1px solid rgba(0,0,0,0.22)',
            }}
          >
            {fr ? 'JOUR 1' : 'DAY 1'}
          </span>
          <strong className="text-[var(--cv-ink)]">
            {fr ? 'Pour démarrer en 2 minutes' : 'First-day setup (disappears once done)'}
          </strong>
          <span className="mono sub" style={{ fontSize: 11 }}>
            {completedCount}/{steps.length}
          </span>
        </div>

        <button
          type="button"
          className="btn"
          style={{ minHeight: 22, padding: '0 8px', fontSize: 11 }}
          onClick={onDismiss}
        >
          {fr ? 'Masquer pour toujours' : 'Dismiss'}
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.id}
            className="flex flex-col justify-between gap-2 border border-[var(--cv-line)] bg-[var(--cv-paper)] p-2.5"
            style={{ opacity: s.done ? 0.72 : 1 }}
          >
            <div className="space-y-1">
              <div className="flex items-start gap-1.5 font-semibold text-[var(--cv-ink)]">
                <span className="mono" style={{ color: s.done ? '#5fd39f' : 'var(--cv-tab)' }}>
                  {s.done ? '✓' : '○'}
                </span>
                <span style={{ textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</span>
              </div>
              <p className="sub m-0 text-[11px] leading-snug">{s.desc}</p>
            </div>
            <button
              type="button"
              className={s.id === 'mcp' && !s.done ? 'btn btn--def self-start' : 'btn self-start'}
              style={{ minHeight: 24, padding: '0 9px', fontSize: 11.5 }}
              onClick={s.onAction}
            >
              {s.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
