import { Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import { fullUrl, withBase } from '../lib/basePath';
import type { Locale } from '../types';
import { buildInstallPrompts } from './HelpPage';

interface Props {
  locale: Locale;
  onLocale: (l: Locale) => void;
  hostedPlan?: string | null;
  landingVideoUrl?: string;
  onNavigate: (path: string) => void;
}

type PreviewTab = 'sheet' | 'privacy' | 'advance';

export function LandingPage({ locale, onLocale, hostedPlan, landingVideoUrl, onNavigate }: Props) {
  const fr = locale === 'fr';
  const [previewTab, setPreviewTab] = useState<PreviewTab>('privacy');
  const [installTab, setInstallTab] = useState<string>('docker');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadOrg, setLeadOrg] = useState('');
  const [leadRoster, setLeadRoster] = useState('2-5 artists');
  const [leadNotes, setLeadNotes] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadDone, setLeadDone] = useState<string | null>(null);
  const [leadErr, setLeadErr] = useState<string | null>(null);

  async function handleInterestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLeadErr(null);
    setLeadDone(null);
    setLeadBusy(true);
    try {
      await api.submitInterest({
        name: leadName.trim() || undefined,
        email: leadEmail.trim(),
        org: leadOrg.trim() || undefined,
        roster_size: leadRoster,
        notes: leadNotes.trim() || undefined,
      });
      setLeadDone(
        fr
          ? 'Message transmis directement. Réponse sous peu.'
          : 'Sent directly. Expect a reply shortly.',
      );
      setLeadName('');
      setLeadEmail('');
      setLeadOrg('');
      setLeadNotes('');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setLeadErr(
        code === 'rate_limited'
          ? fr
            ? 'Trop de tentatives — réessayez dans quelques minutes.'
            : 'Too many requests — please try again shortly.'
          : fr
            ? 'Veuillez saisir une adresse email valide.'
            : 'Please enter a valid work email.',
      );
    } finally {
      setLeadBusy(false);
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
        {/* Top BeOS Window Bar */}
        <div className="dk-tabrow">
          <div className="ytab" style={{ margin: '0 0 -1px -1px' }}>
            <span className="box" />
            <span>tourdesigner</span>
            {hostedPlan && <span className="dk-venue hidden sm:inline">· {hostedPlan}</span>}
          </div>
          <div className="ml-auto flex items-center gap-1.5 pb-[3px]">
            <button
              type="button"
              className="btn"
              style={{ minHeight: 24, padding: '0 10px', fontSize: 12 }}
              onClick={() => onNavigate('/help')}
            >
              {fr ? 'Aide & IA' : 'Help & AI'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 24, padding: '0 10px', fontSize: 12 }}
              onClick={() => onNavigate('/login')}
            >
              {fr ? 'Connexion' : 'Sign in'}
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

        {/* Main Operations Surface */}
        <section className="win px-3.5 py-4 sm:p-7 space-y-5 sm:space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1.06fr_1fr] lg:items-center">
            {/* Editorial Copy */}
            <div className="space-y-3.5 sm:space-y-4">
              <div className="mono sub whitespace-nowrap truncate" style={{ fontSize: 10.5, letterSpacing: '0.07em' }}>
                {fr ? 'TOURNÉES · HORS LIGNE · CACHETS PRIVÉS' : 'ROUTING · GATE OFFLINE · FEE PRIVACY'}
              </div>
              <h1
                className="m-0 font-bold tracking-tight"
                style={{ fontSize: 'clamp(25px, 6.2vw, 40px)', lineHeight: 1.07, color: 'var(--cv-ink)' }}
              >
                {fr
                  ? 'Vols, chauffeurs, cachets et passeports. Prêts à l’embarquement.'
                  : 'Every flight, driver, fee, and passport. Ready offline.'}
              </h1>
              <p className="sub m-0 text-[13.5px] sm:text-sm leading-relaxed" style={{ maxWidth: '46ch' }}>
                {fr
                  ? 'Une correspondance ratée, un passeport expiré ou un cachet transféré par erreur abîment une réputation. Gardez deals et visas verrouillés tout en livrant aux équipes des feuilles de route instantanées sans réseau.'
                  : 'One missed transfer, expired crew passport, or forwarded settlement sheet costs money and trust. Keep deals, contracts, and visas isolated while your team gets instant offline roadsheets.'}
              </p>

              {/* High-visibility Fitts's-Law primary + exploratory actions (44px touch height) */}
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 pt-1">
                <button
                  type="button"
                  className="btn btn--def w-full sm:w-auto justify-center"
                  style={{ minHeight: 44, padding: '0 18px', fontWeight: 700, fontSize: 13.5 }}
                  onClick={() => onNavigate('/demo')}
                >
                  {fr ? 'Explorer la tournée démo (20 dates) →' : 'Explore 20-date tour (no signup) →'}
                </button>
                <button
                  type="button"
                  className="btn w-full sm:w-auto justify-center"
                  style={{ minHeight: 44, padding: '0 16px', fontSize: 13 }}
                  onClick={() => onNavigate('/login')}
                >
                  {fr ? 'Créer mon espace' : 'Start workspace'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11.5px] sm:text-xs sub">
                <span>{fr ? 'Joseph Le Hype × DJ Triesto · Billets, visas & multi-escales inclus' : 'Joseph Le Hype × DJ Triesto · Mock passes, visas & layovers'}</span>
              </div>
            </div>

            {/* Interactive Desk Preview OR Walkthrough Video */}
            <div className="win" style={{ background: 'var(--cv-paper)' }}>
              {landingVideoUrl ? (
                <div className="aspect-video w-full overflow-hidden bg-black">
                  <iframe
                    src={landingVideoUrl}
                    title="Tour Designer walkthrough"
                    className="h-full w-full border-0"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <>
                  {/* Window Header & Contrast Mode Switcher */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--cv-line2)] px-2.5 sm:px-3 py-2"
                    style={{ background: 'var(--cv-chrome2)' }}
                  >
                    <div className="flex items-center gap-2 text-xs min-w-0">
                      <span className="mono font-bold truncate" style={{ color: 'var(--cv-ink)' }}>
                        JOSEPH LE HYPE · CDMX
                      </span>
                      <span className="sub hidden sm:inline whitespace-nowrap">LooLoo Studio</span>
                    </div>
                    <div className="segs max-w-full overflow-x-auto">
                      <button
                        type="button"
                        className={`seg whitespace-nowrap${previewTab === 'privacy' ? ' seg--on' : ''}`}
                        onClick={() => setPreviewTab('privacy')}
                      >
                        {fr ? 'Vue chauffeur' : 'Driver /link/'}
                      </button>
                      <button
                        type="button"
                        className={`seg whitespace-nowrap${previewTab === 'sheet' ? ' seg--on' : ''}`}
                        onClick={() => setPreviewTab('sheet')}
                      >
                        {fr ? 'Feuille du jour' : 'Day sheet'}
                      </button>
                      <button
                        type="button"
                        className={`seg whitespace-nowrap${previewTab === 'advance' ? ' seg--on' : ''}`}
                        onClick={() => setPreviewTab('advance')}
                      >
                        {fr ? 'Billets & Visas' : 'Vault docs'}
                      </button>
                    </div>
                  </div>

                  {/* Interactive Preview Body */}
                  <div className="p-2.5 sm:p-3 text-xs space-y-2" style={{ minHeight: 196 }}>
                    {previewTab === 'privacy' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 border border-[var(--cv-line2)] bg-[var(--cv-paper2)] px-2 sm:px-2.5 py-1.5">
                          <span className="font-semibold min-w-0 truncate">
                            {fr ? 'Rôle filtré (/link/demo)' : 'Role-scoped view (/link/demo)'}
                          </span>
                          <span className="mono shrink-0 whitespace-nowrap" style={{ fontSize: 10, color: 'var(--cv-online)', fontWeight: 700 }}>
                            {fr ? 'CACHETS MASQUÉS' : 'DEALS SCRUBBED'}
                          </span>
                        </div>
                        <div className="border border-[var(--cv-line)] divide-y divide-[var(--cv-line)]">
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate">Fee · $45,000 USD + 50% Door</span>
                            <span className="mono font-bold shrink-0 whitespace-nowrap" style={{ color: 'var(--cv-warn)' }}>REDACTED</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate">Passports, Visas &amp; TM Alert</span>
                            <span className="mono font-bold shrink-0 whitespace-nowrap" style={{ color: 'var(--cv-warn)' }}>OWNER ONLY</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate">Pickup 17:45 MEX T2 · Carlos</span>
                            <span className="mono font-bold shrink-0 whitespace-nowrap" style={{ color: 'var(--cv-online)' }}>VISIBLE</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate">Soundcheck 20:30 · Set 01:30–03:30</span>
                            <span className="mono font-bold shrink-0 whitespace-nowrap" style={{ color: 'var(--cv-online)' }}>VISIBLE</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {previewTab === 'sheet' && (
                      <>
                        <div className="flex items-center justify-between gap-2 border border-[var(--cv-nextline)] bg-[var(--cv-next)] px-2 sm:px-2.5 py-1.5">
                          <span className="min-w-0 truncate">
                            <strong>BA117 LHR→JFK · AM403 MEX</strong> · 1A
                          </span>
                          <span className="mono font-bold shrink-0 whitespace-nowrap">PNR E0AM77</span>
                        </div>
                        <div className="border border-[var(--cv-line)] divide-y divide-[var(--cv-line)]">
                          <div className="grid grid-cols-[54px_minmax(0,1fr)_auto] sm:grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="mono font-semibold whitespace-nowrap">08:25</span>
                            <span className="truncate">LHR → JFK (1h30 transit) → MEX</span>
                            <span className="mono sub shrink-0 whitespace-nowrap">T4 · 1A</span>
                          </div>
                          <div className="grid grid-cols-[54px_minmax(0,1fr)_auto] sm:grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="mono font-semibold whitespace-nowrap">17:45</span>
                            <span className="truncate">Armored Suburban · Carlos M.</span>
                            <span className="mono sub shrink-0 whitespace-nowrap">+52 55…</span>
                          </div>
                          <div className="grid grid-cols-[54px_minmax(0,1fr)_auto] sm:grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="mono font-semibold whitespace-nowrap">18:15</span>
                            <span className="truncate">Beat 100.9 FM Interview + Check</span>
                            <span className="mono sub shrink-0 whitespace-nowrap">Brick Hotel</span>
                          </div>
                          <div
                            className="grid grid-cols-[54px_minmax(0,1fr)_auto] sm:grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5"
                            style={{ background: 'var(--cv-sepbg)' }}
                          >
                            <span className="mono font-bold whitespace-nowrap">01:30</span>
                            <span className="font-bold truncate">Joseph Le Hype (Main Room)</span>
                            <span className="mono sub shrink-0 whitespace-nowrap">Set</span>
                          </div>
                        </div>
                      </>
                    )}

                    {previewTab === 'advance' && (
                      <div className="space-y-2">
                        <div className="border border-[var(--cv-line)] divide-y divide-[var(--cv-line)]">
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate"><strong>AM403-JFK-MEX-Pass</strong></span>
                            <span className="mono sub shrink-0 whitespace-nowrap">1A · E0AM77</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate"><strong>Marcus-Vance-Passport</strong></span>
                            <span className="mono shrink-0 whitespace-nowrap" style={{ color: 'var(--cv-warn)', fontWeight: 700 }}>EXPIRES &lt;45D</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate"><strong>US-O1B &amp; Japan-COE Visas</strong></span>
                            <span className="mono sub shrink-0 whitespace-nowrap">Offline vault</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1.5">
                            <span className="min-w-0 truncate"><strong>Booth Plot (CDJ-3000 + A9)</strong></span>
                            <span className="mono sub shrink-0 whitespace-nowrap">FOH spec</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--cv-line)] px-3 py-1.5 text-[11px] sub"
                    style={{ background: 'var(--cv-chrome2)' }}
                  >
                    <span className="mono whitespace-nowrap">{fr ? 'Hors ligne · Prêt' : 'Offline · Gate ready'}</span>
                    <button
                      type="button"
                      className="underline font-semibold whitespace-nowrap"
                      style={{ background: 'none', border: 0, padding: 0, color: 'var(--cv-ink)', cursor: 'pointer' }}
                      onClick={() => onNavigate('/demo')}
                    >
                      {fr ? 'Tester tout le tour (20 dates) →' : 'Dig into the 20-date demo →'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 3 Quiet Operational Pillars */}
          <div className="grid gap-4 border-t border-[var(--cv-line)] pt-5 md:grid-cols-3 text-xs">
            <div className="space-y-1.5">
              <div className="mono sub" style={{ fontSize: 10.5 }}>01 / {fr ? 'CONFIDENTIALITÉ' : 'CONFIDENTIALITY'}</div>
              <div className="font-bold text-sm" style={{ color: 'var(--cv-ink)' }}>
                {fr ? 'Vos deals restent chez vous' : 'Zero fee or contract leaks'}
              </div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Cachets, acomptes, passeports et visas restent verrouillés côté management. Les liens /link/ n’exposent que le nécessaire sur le terrain.'
                  : 'Settlements, buyouts, and passport scans stay owner-locked. Role-scoped /link/ sheets give drivers and promoters zero visibility into deals.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="mono sub" style={{ fontSize: 10.5 }}>02 / {fr ? 'À LA PORTE' : 'OFFLINE'}</div>
              <div className="font-bold text-sm" style={{ color: 'var(--cv-ink)' }}>
                {fr ? 'Zéro réseau en loge ou au contrôle' : 'Fastest when you are late to board'}
              </div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Toute la tournée, vos PNR et vos cartes d’embarquement restent en cache local sur iOS, Android et Mac — consultables sans réseau, avec synchro automatique dès le retour du signal.'
                  : 'Your full itinerary, hotel confirmations, and boarding passes stay cached on mobile and desktop — readable with zero signal, with queued edits syncing once you reconnect.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="mono sub" style={{ fontSize: 10.5 }}>03 / {fr ? 'CONTRÔLE' : 'CONTROL'}</div>
              <div className="font-bold text-sm" style={{ color: 'var(--cv-ink)' }}>
                {fr ? 'Multi-artistes & alerte passeports' : 'Stacked routing, alerts & MCP'}
              </div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Basculez entre artistes en un clic, importez des plannings CSV complets, recevez les alertes d’expiration de visa et branchez Claude/GPT.'
                  : 'Manage multi-artist rosters, catch expiring crew passports automatically, batch-import routing CSVs, or push passes straight from Claude/ChatGPT.'}
              </p>
            </div>
          </div>

          {/* 1-Prompt AI Install for Claude Code & Codex */}
          {(() => {
            const originRoot =
              typeof window !== 'undefined' ? fullUrl('/').replace(/\/$/, '') : 'https://www.djmandragora.com/tourdesigner';
            const prompts = buildInstallPrompts(originRoot, fr);
            const active = prompts.find((p) => p.id === installTab) || prompts[0];
            return (
              <div className="border-t border-[var(--cv-line)] pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-bold text-sm" style={{ color: 'var(--cv-ink)' }}>
                      <Terminal className="h-4 w-4" style={{ color: 'var(--cv-y1)' }} />
                      <span>
                        {fr
                          ? 'Installation en 1 prompt (Claude Code / Codex)'
                          : 'Install for your team in 1 prompt (Claude Code / Codex)'}
                      </span>
                    </div>
                    <p className="sub m-0 text-xs">
                      {fr
                        ? 'Collez ce prompt dans Claude Code, Codex ou Cursor — il lit notre doc LLM et déploie Tour Designer pour votre équipe.'
                        : 'Paste this into Claude Code, OpenAI Codex, or Cursor — it reads our LLM integration spec and installs Tour Designer for your crew.'}
                    </p>
                  </div>
                  <div className="segs max-w-full overflow-x-auto">
                    {prompts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`seg whitespace-nowrap${installTab === p.id ? ' seg--on' : ''}`}
                        onClick={() => {
                          setInstallTab(p.id);
                          setCopiedPrompt(false);
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-[var(--cv-line2)] bg-[var(--cv-paper)] p-3 sm:p-3.5 space-y-2.5">
                  <pre
                    className="m-0 whitespace-pre-wrap break-words mono text-[11.5px] sm:text-xs leading-relaxed"
                    style={{ color: 'var(--cv-ink)' }}
                  >
                    {active.prompt}
                  </pre>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-[var(--cv-line)] pt-2.5">
                    <div className="flex flex-wrap items-center gap-3 text-[11.5px] sub">
                      <button
                        type="button"
                        className="underline font-semibold"
                        style={{ background: 'none', border: 0, padding: 0, color: 'var(--cv-ink)', cursor: 'pointer' }}
                        onClick={() => onNavigate('/help')}
                      >
                        {fr ? 'Guide complet & intégration SI →' : 'Full Help & IT integration guide →'}
                      </button>
                      <a
                        href={withBase('/llms.txt')}
                        target="_blank"
                        rel="noreferrer"
                        className="mono underline inline-flex items-center gap-1"
                        style={{ color: 'var(--cv-ink2)' }}
                      >
                        /llms.txt <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={withBase('/llms-full.txt')}
                        target="_blank"
                        rel="noreferrer"
                        className="mono underline inline-flex items-center gap-1"
                        style={{ color: 'var(--cv-ink2)' }}
                      >
                        /llms-full.txt <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <button
                      type="button"
                      className="btn btn--def w-full sm:w-auto justify-center"
                      style={{ minHeight: 38, padding: '0 14px', fontWeight: 700 }}
                      onClick={() => {
                        navigator.clipboard?.writeText(active.prompt).catch(() => undefined);
                        setCopiedPrompt(true);
                        window.setTimeout(() => setCopiedPrompt(false), 2000);
                      }}
                    >
                      {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedPrompt ? (fr ? 'Copié !' : 'Copied!') : fr ? 'Copier le prompt' : 'Copy prompt'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Access & Management Inquiry */}
          <div className="grid gap-4 border-t border-[var(--cv-line)] pt-5 md:grid-cols-2">
            <div className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-3.5 sm:p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{fr ? 'Artiste & tour manager' : 'Individual artist & TM workspace'}</span>
                <span className="mono shrink-0" style={{ color: 'var(--cv-y1)', fontWeight: 700 }}>{hostedPlan || 'Free Beta'}</span>
              </div>
              <p className="sub m-0 leading-relaxed">
                {fr
                  ? 'Espace cloud isolé, cache hors ligne local (les modifs se synchronisent dès le retour du réseau), coffre-fort documents chiffré, serveur MCP mobile et export JSON complet.'
                  : 'Isolated workspace with local offline cache (edits sync automatically once back online), encrypted document & passport vault, mobile MCP assistant access, and 1-click JSON export.'}
              </p>
              <div className="mono sub space-y-1 pt-1 text-[11px]">
                <div>· {fr ? 'Jusqu’à 200 dates & 250 Mo de coffre-fort' : 'Up to 200 tour dates & 250 MB document vault'}</div>
                <div>· {fr ? 'Connexion Google ou Email + Mot de passe' : 'Sign in with Google or Email & Password'}</div>
                <div>· {fr ? 'Auto-hébergement Docker / AGPL-3.0 sans verrouillage' : 'Self-host via Docker / AGPL-3.0 with zero lock-in'}</div>
              </div>
              <div className="pt-1 flex flex-col sm:flex-row sm:flex-wrap gap-2">
                <button type="button" className="btn btn--def w-full sm:w-auto justify-center" style={{ minHeight: 40 }} onClick={() => onNavigate('/login')}>
                  {fr ? 'Créer un compte gratuit' : 'Create free account'}
                </button>
                <a
                  href="https://github.com/holasoyneto/tourdesigner"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn w-full sm:w-auto justify-center"
                  style={{ textDecoration: 'none', minHeight: 40 }}
                >
                  GitHub (AGPL-3.0)
                </a>
              </div>
            </div>

            <form onSubmit={handleInterestSubmit} className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-3.5 sm:p-4 space-y-2.5 text-xs">
              <div className="font-bold text-sm">
                {fr ? 'Agences, managements & marque blanche' : 'Management, agencies & white-label'}
              </div>
              <p className="sub m-0">
                {fr
                  ? 'Besoin de gérer un roster complet, un domaine privé ou une licence commerciale ? Envoyé directement par email.'
                  : 'Running a multi-artist roster, custom domain, or commercial white-label deployment? Delivered directly to our inbox.'}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="in"
                  placeholder={fr ? 'Nom' : 'Name'}
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                />
                <input
                  type="email"
                  required
                  className="in"
                  placeholder="booking@agency.com"
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="in"
                  placeholder={fr ? 'Agence / Management' : 'Agency / Management'}
                  value={leadOrg}
                  onChange={(e) => setLeadOrg(e.target.value)}
                />
                <select className="in" value={leadRoster} onChange={(e) => setLeadRoster(e.target.value)}>
                  <option value="1 artist">1 artist</option>
                  <option value="2-5 artists">2–5 artists</option>
                  <option value="6-20 artists">6–20 artists</option>
                  <option value="20+ artists">20+ artists</option>
                </select>
              </div>
              <textarea
                className="in"
                rows={2}
                placeholder={fr ? 'Besoins ou volume de dates…' : 'Roster scale or deployment notes…'}
                value={leadNotes}
                onChange={(e) => setLeadNotes(e.target.value)}
              />
              {leadDone && <div className="dk-next" style={{ padding: '6px 8px' }}>{leadDone}</div>}
              {leadErr && <div className="warn">{leadErr}</div>}
              <button
                type="submit"
                className="btn btn--def w-full sm:w-auto justify-center"
                style={{ fontWeight: 700, minHeight: 42 }}
                disabled={leadBusy || !leadEmail.trim()}
              >
                {leadBusy ? '…' : fr ? 'Envoyer la demande' : 'Send inquiry'}
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--cv-line)] pt-3 text-[11px] sub">
            <span>Tour Designer · AGPL-3.0-only · Zero tracking cookies</span>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="underline"
                style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                onClick={() => onNavigate('/help')}
              >
                {fr ? 'Aide & Docs LLM' : 'Help & LLM Docs'}
              </button>
              <a href={withBase('/llms.txt')} target="_blank" rel="noreferrer" className="underline mono" style={{ color: 'inherit' }}>
                llms.txt
              </a>
              <button
                type="button"
                className="underline"
                style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                onClick={() => onNavigate('/legal/terms')}
              >
                {fr ? 'Conditions' : 'Terms'}
              </button>
              <button
                type="button"
                className="underline"
                style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                onClick={() => onNavigate('/legal/privacy')}
              >
                {fr ? 'Confidentialité (RGPD / US / MX)' : 'Privacy (GDPR / US / MX)'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
