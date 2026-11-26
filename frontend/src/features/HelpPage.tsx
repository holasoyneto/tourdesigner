import { Check, Copy, ExternalLink, Shield, Terminal, Wrench } from 'lucide-react';
import { useState } from 'react';
import { fullUrl, withBase } from '../lib/basePath';
import type { Locale } from '../types';

interface Props {
  locale: Locale;
  onLocale: (l: Locale) => void;
  onNavigate: (path: string) => void;
}

const REPO_URL = 'https://github.com/holasoyneto/tourdesigner';

export function buildInstallPrompts(originUrl: string, fr: boolean) {
  const llmsUrl = `${originUrl}/llms-full.txt`;
  return [
    {
      id: 'docker',
      label: fr ? 'Auto-hébergement Docker (60s)' : 'Self-Host Docker (60s)',
      audience: fr ? 'VPS Linux, Mac Mini, serveur d’équipe' : 'Linux VPS, Mac Mini, team server',
      prompt: fr
        ? `Lis la doc d’intégration ${llmsUrl} puis clone ${REPO_URL} et installe Tour Designer pour mon équipe de tournée avec Docker Compose (SQLite + stockage local dans ./data). Génère un SESSION_SECRET aléatoire et un mot de passe propriétaire fort dans .env, configure un reverse proxy HTTPS (Caddy ou Nginx) si un domaine est disponible, vérifie /api/health, et donne-moi l’URL de connexion et la commande de sauvegarde quotidienne.`
        : `Read the integration guide at ${llmsUrl}, then clone ${REPO_URL} and install Tour Designer for my touring team using Docker Compose (SQLite + local vault in ./data). Generate a random SESSION_SECRET and strong owner password in .env, wire an HTTPS reverse proxy (Caddy or Nginx) if we have a domain, verify /api/health, and hand me the login URL plus a nightly backup command.`,
    },
    {
      id: 'it',
      label: fr ? 'Intégration SI / Agence' : 'Team IT & Calendar Integration',
      audience: fr ? 'Google Calendar, Master Tour CSV, SMTP, Slack' : 'Google Calendar, Master Tour CSV, SMTP, Slack',
      prompt: fr
        ? `Lis ${llmsUrl} et intègre Tour Designer (${REPO_URL}) à l’infrastructure de notre agence : 1) déploie-le sur notre serveur ou Cloud Run (Firestore + GCS si stateless), 2) active Google OAuth pour l’équipe, 3) configure SMTP ou Resend pour les résumés J-1 (/api/cron/gig-digest), 4) explique comment importer nos plannings CSV / Master Tour via /api/intake/extract et abonner nos calendriers au flux révocable /api/calendar/{token}.ics.`
        : `Read ${llmsUrl} and integrate Tour Designer (${REPO_URL}) into our agency IT stack: 1) deploy it on our server or stateless Cloud Run (Firestore + GCS), 2) enable Google OAuth for the team, 3) wire SMTP or Resend for J-1 crew digests (/api/cron/gig-digest), and 4) show how to bulk-import our Master Tour / CSV schedules via /api/intake/extract and subscribe team calendars to /api/calendar/{token}.ics.`,
    },
    {
      id: 'mcp',
      label: fr ? 'Connecter Claude / ChatGPT MCP' : 'Connect Claude / ChatGPT MCP',
      audience: fr ? 'Ajout de vols par email & cartes d’embarquement mobiles' : 'Email-to-flight automation & mobile QR passes',
      prompt: fr
        ? `Lis la section MCP de ${llmsUrl} et configure le serveur MCP de notre instance Tour Designer (<URL>/mcp) dans Claude Desktop / Claude Code / Codex avec un jeton Bearer créé dans Paramètres → AI / MCP. Vérifie ensuite l’outil list_gigs en lecture seule et montre-moi le prompt exact pour ajouter un vol depuis un email.`
        : `Read the MCP section of ${llmsUrl} and connect our Tour Designer instance (<URL>/mcp) to Claude Desktop / Claude Code / Codex using a Bearer token from Settings → AI / MCP. Verify read-only access with list_gigs, then show me how to add a flight straight from an airline confirmation email.`,
    },
  ];
}

export function HelpPage({ locale, onLocale, onNavigate }: Props) {
  const fr = locale === 'fr';
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activePrompt, setActivePrompt] = useState('docker');

  const originRoot =
    typeof window !== 'undefined' ? fullUrl('/').replace(/\/$/, '') : 'https://www.djmandragora.com/tourdesigner';
  const prompts = buildInstallPrompts(originRoot, fr);
  const currentPrompt = prompts.find((p) => p.id === activePrompt) || prompts[0];

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    } catch {
      setCopiedKey(null);
    }
  }

  return (
    <div
      className="dk-root"
      style={{
        display: 'block',
        height: 'auto',
        minHeight: '100dvh',
        overflowY: 'auto',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(10px, env(safe-area-inset-left))',
        paddingRight: 'max(10px, env(safe-area-inset-right))',
      }}
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Welded BeOS Window Tab */}
        <div className="dk-tabrow">
          <div className="ytab" style={{ margin: '0 0 -1px -1px' }}>
            <button type="button" className="box" title={fr ? 'Accueil' : 'Home'} onClick={() => onNavigate('/')} />
            <span>tourdesigner</span>
            <span className="dk-venue hidden sm:inline">· {fr ? 'Aide & Intégration IA' : 'Help & LLM Docs'}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 pb-[3px]">
            <button
              type="button"
              className="btn"
              style={{ minHeight: 24, padding: '0 10px', fontSize: 12 }}
              onClick={() => onNavigate('/demo')}
            >
              {fr ? 'Démo' : 'Live demo'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 24, padding: '0 10px', fontSize: 12 }}
              onClick={() => onNavigate('/')}
            >
              {fr ? 'Accueil' : 'Home'}
            </button>
            <button
              type="button"
              className="btn mono"
              style={{ minHeight: 24, minWidth: 32, padding: '0 8px', fontSize: 11.5 }}
              onClick={() => onLocale(fr ? 'en' : 'fr')}
            >
              {fr ? 'EN' : 'FR'}
            </button>
          </div>
        </div>

        <main className="win px-3.5 py-4 sm:p-7 space-y-6">
          {/* Header */}
          <header className="space-y-2 border-b border-[var(--cv-line)] pb-5">
            <div className="mono sub text-[10.5px]" style={{ letterSpacing: '0.07em' }}>
              {fr ? 'GUIDE D’INSTALLATION · CLAUDE CODE · CODEX · IT' : 'INSTALL GUIDE · CLAUDE CODE · CODEX · IT SYSTEMS'}
            </div>
            <h1 className="m-0 font-bold tracking-tight" style={{ fontSize: 'clamp(22px, 5vw, 32px)', lineHeight: 1.1 }}>
              {fr
                ? 'Installez et intégrez Tour Designer avec votre assistant IA.'
                : 'Install & integrate Tour Designer with Claude or Codex.'}
            </h1>
            <p className="sub m-0 text-sm leading-relaxed" style={{ maxWidth: '64ch' }}>
              {fr
                ? 'Copiez un prompt ci-dessous dans Claude Code, Codex ou Cursor pour installer Tour Designer sur le serveur de votre équipe en 60 secondes, ou pointez directement votre LLM vers /llms.txt et /llms-full.txt.'
                : 'Paste a prompt below into Claude Code, OpenAI Codex, or Cursor to deploy Tour Designer for your team in 60 seconds — or hand /llms.txt and /llms-full.txt straight to your IT engineer or AI agent.'}
            </p>
          </header>

          {/* Pastable LLM Prompts */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Terminal className="h-4 w-4" style={{ color: 'var(--cv-y1)' }} />
                <span>{fr ? 'Prompts prêts à coller (Claude Code / Codex)' : 'Copy-paste prompts for Claude Code & Codex'}</span>
              </div>
              <div className="segs max-w-full overflow-x-auto">
                {prompts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`seg whitespace-nowrap${activePrompt === p.id ? ' seg--on' : ''}`}
                    onClick={() => setActivePrompt(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-[var(--cv-line2)] bg-[var(--cv-paper)] p-3.5 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="sub">{currentPrompt.audience}</span>
                <button
                  type="button"
                  className="btn btn--def"
                  style={{ minHeight: 34, padding: '0 12px', fontWeight: 700 }}
                  onClick={() => void copyText(currentPrompt.id, currentPrompt.prompt)}
                >
                  {copiedKey === currentPrompt.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === currentPrompt.id
                    ? fr ? 'Prompt copié !' : 'Prompt copied!'
                    : fr ? 'Copier le prompt' : 'Copy prompt'}
                </button>
              </div>
              <pre
                className="m-0 whitespace-pre-wrap break-words border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-3 mono text-xs leading-relaxed"
                style={{ color: 'var(--cv-ink)' }}
              >
                {currentPrompt.prompt}
              </pre>
            </div>
          </section>

          {/* Machine-readable LLM Resources */}
          <section className="grid gap-3 md:grid-cols-3 text-xs">
            <div className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-3.5 space-y-2">
              <div className="mono font-bold" style={{ color: 'var(--cv-y1)' }}>/llms.txt</div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Index concis au standard llms.txt : architecture, démarrage Docker, endpoints MCP et liens de doc.'
                  : 'Compact llms.txt index: architecture overview, 1-command Docker start, MCP endpoints, and doc links.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={withBase('/llms.txt')} target="_blank" rel="noreferrer" className="btn" style={{ minHeight: 30 }}>
                  {fr ? 'Ouvrir' : 'Open'} <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 30 }}
                  onClick={() => void copyText('llms', `${originRoot}/llms.txt`)}
                >
                  {copiedKey === 'llms' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedKey === 'llms' ? (fr ? 'Copié' : 'Copied') : 'URL'}
                </button>
              </div>
            </div>

            <div className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-3.5 space-y-2">
              <div className="mono font-bold" style={{ color: 'var(--cv-y1)' }}>/llms-full.txt</div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Manuel complet d’intégration SI (env vars, reverse proxy, Cloud Run, OAuth, SMTP, .ics, sauvegardes) lisible en un fetch.'
                  : 'Complete IT integration handbook (env vars, reverse proxy, Cloud Run, OAuth, SMTP, .ics, backups) in one clean text fetch.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={withBase('/llms-full.txt')} target="_blank" rel="noreferrer" className="btn" style={{ minHeight: 30 }}>
                  {fr ? 'Ouvrir' : 'Open'} <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 30 }}
                  onClick={() => void copyText('llms_full', `${originRoot}/llms-full.txt`)}
                >
                  {copiedKey === 'llms_full' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedKey === 'llms_full' ? (fr ? 'Copié' : 'Copied') : 'URL'}
                </button>
              </div>
            </div>

            <div className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-3.5 space-y-2">
              <div className="mono font-bold" style={{ color: 'var(--cv-y1)' }}>GitHub · AGPL-3.0</div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Code source complet, Dockerfile multi-stage, docker-compose.yml et docs/LLM_INTEGRATION.md.'
                  : 'Full open-source repo, multi-stage Dockerfile, docker-compose.yml, and docs/LLM_INTEGRATION.md.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="btn" style={{ minHeight: 30 }}>
                  GitHub <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 30 }}
                  onClick={() => void copyText('clone', `git clone ${REPO_URL} && cd tourdesigner && docker compose up -d --build`)}
                >
                  {copiedKey === 'clone' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedKey === 'clone' ? (fr ? 'Copié' : 'Copied') : 'Docker cmd'}
                </button>
              </div>
            </div>
          </section>

          {/* IT Integration & Security Reference */}
          <section className="grid gap-4 md:grid-cols-2 text-xs border-t border-[var(--cv-line)] pt-5">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Wrench className="h-4 w-4" style={{ color: 'var(--cv-y1)' }} />
                <span>{fr ? 'Points d’intégration SI & API' : 'IT System & API Touchpoints'}</span>
              </div>
              <div className="border border-[var(--cv-line)] divide-y divide-[var(--cv-line)] bg-[var(--cv-paper)]">
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="mono font-semibold">POST /mcp</span>
                  <span className="sub text-right">{fr ? 'Serveur MCP (Claude, ChatGPT, Codex)' : 'MCP server (Claude, ChatGPT, Codex)'}</span>
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="mono font-semibold">GET /api/calendar/&#123;tok&#125;.ics</span>
                  <span className="sub text-right">{fr ? 'Flux iCal révocable (Google / Apple)' : 'Revocable iCal feed (Google / Apple)'}</span>
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="mono font-semibold">POST /api/intake/extract</span>
                  <span className="sub text-right">{fr ? 'Import CSV / Master Tour / emails' : 'Bulk CSV / Master Tour / email intake'}</span>
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="mono font-semibold">POST /api/cron/gig-digest</span>
                  <span className="sub text-right">{fr ? 'Rappels J-1 SMTP ou Resend' : 'J-1 crew digests (SMTP or Resend)'}</span>
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="mono font-semibold">GET /api/health</span>
                  <span className="sub text-right">{fr ? 'Sonde statut & révision' : 'Health & revision probe'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Shield className="h-4 w-4" style={{ color: 'var(--cv-online)' }} />
                <span>{fr ? 'Sécurité, Rôles & Hors-Ligne' : 'Security, Isolation & Offline'}</span>
              </div>
              <div className="border border-[var(--cv-line)] bg-[var(--cv-paper)] p-3 space-y-2 leading-relaxed">
                <p className="m-0">
                  <strong>{fr ? 'Cloisonnement financier :' : 'Fee & vault isolation:'}</strong>{' '}
                  <span className="sub">
                    {fr
                      ? 'Les cachets, contrats, passeports et visas privés restent réservés au propriétaire. Les liens /link/<clé> pour chauffeurs ou promoteurs les excluent côté serveur.'
                      : 'Settlements, buyouts, passports, and private files stay owner-locked. Role-scoped /link/<key> sheets strip them server-side.'}
                  </span>
                </p>
                <p className="m-0">
                  <strong>{fr ? 'MCP stateless & anti-écrasement :' : 'Stateless MCP CAS guard:'}</strong>{' '}
                  <span className="sub">
                    {fr
                      ? 'Chaque écriture MCP vérifie un jeton HMAC read_token pour empêcher un agent IA d’écraser une modification manuelle.'
                      : 'Every mutating MCP call verifies a stateless HMAC read_token so an AI agent never silently overwrites manual edits.'}
                  </span>
                </p>
                <p className="m-0">
                  <strong>{fr ? 'Zéro dépendance cloud par défaut :' : 'Zero cloud lock-in:'}</strong>{' '}
                  <span className="sub">
                    {fr
                      ? 'SQLite + fichiers locaux par défaut sous Docker, ou bascule en 2 variables vers Firestore + GCS sur Cloud Run.'
                      : 'Runs on SQLite + local disk out of the box in Docker, or flips to stateless Firestore + GCS with two env vars.'}
                  </span>
                </p>
              </div>
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--cv-line)] pt-3 text-[11px] sub">
            <span>Tour Designer · AGPL-3.0-only · Self-host or Free Beta</span>
            <div className="flex gap-3">
              <button
                type="button"
                className="underline"
                style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                onClick={() => onNavigate('/demo')}
              >
                {fr ? 'Démo 20 dates' : '20-date demo'}
              </button>
              <button
                type="button"
                className="underline"
                style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                onClick={() => onNavigate('/login')}
              >
                {fr ? 'Connexion' : 'Sign in'}
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
