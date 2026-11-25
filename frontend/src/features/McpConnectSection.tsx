import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { fullUrl } from '../lib/basePath';
import type { Locale, User } from '../types';

interface Props {
  user: User;
  locale: Locale;
  onMcpConnected?: () => void;
}

type ClientTab = 'claude' | 'chatgpt' | 'gemini' | 'grok';

export function McpConnectSection({ user, locale, onMcpConnected }: Props) {
  const fr = locale === 'fr';
  const [tab, setTab] = useState<ClientTab>('claude');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState(Boolean(user.has_mcp_key));
  const [issued, setIssued] = useState<{ mcp_key: string; mcp_url: string; bearer_endpoint: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#mcp') {
      document.getElementById('mcp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  if (user.role === 'viewer') return null;

  const displayUrl = issued?.mcp_url || fullUrl('/mcp/<YOUR_PERSONAL_MCP_TOKEN>');
  const displayBearerEndpoint = issued?.bearer_endpoint || fullUrl('/mcp');
  const displayToken = issued?.mcp_key || '<YOUR_PERSONAL_MCP_TOKEN>';

  async function copyText(id: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
  }

  async function handleGenerate() {
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await api.issueMyMcpKey();
      setIssued({
        mcp_key: res.mcp_key,
        mcp_url: res.mcp_url,
        bearer_endpoint: res.bearer_endpoint,
      });
      setHasKey(true);
      onMcpConnected?.();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'mcp_key_error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    setErrMsg(null);
    try {
      await api.revokeMyMcpKey();
      setIssued(null);
      setHasKey(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'mcp_revoke_error');
    } finally {
      setBusy(false);
    }
  }

  const claudeCodeCmd = `claude mcp add --transport http tour-designer "${displayUrl}"`;
  const geminiCliCmd = `gemini mcp add --transport http tour-designer "${displayUrl}"`;
  const genericJson = JSON.stringify(
    {
      mcpServers: {
        'tour-designer': {
          url: displayBearerEndpoint,
          transport: 'http',
          headers: {
            Authorization: `Bearer ${displayToken}`,
          },
        },
      },
    },
    null,
    2,
  );

  const automationPrompts = [
    {
      id: 'boarding',
      title: fr ? 'Carte d’embarquement dans le chat' : 'Boarding pass & files in chat',
      prompt: fr
        ? 'Appelle list_files dans Tour Designer pour ma prochaine date et affiche ma carte d’embarquement ou mon bon d’hôtel avec get_file.'
        : 'Call list_files in Tour Designer for my next show and show me my boarding pass or hotel voucher using get_file.',
    },
    {
      id: 'briefing',
      title: fr ? 'Briefing matinal (8h00)' : 'Daily morning briefing',
      prompt: fr
        ? 'Chaque matin à 8h, appelle get_daily_briefing(days_ahead=3) dans Tour Designer et résume vols, hôtels, soundcheck, set, rappels et éléments manquants.'
        : 'Every morning at 8am, call get_daily_briefing(days_ahead=3) in Tour Designer and send me today’s flights, hotel check-ins, soundcheck/set times, overdue reminders, and missing confirmations.',
    },
    {
      id: 'reminders',
      title: fr ? 'Rappels d’avancement auto' : 'Auto advancing reminders',
      prompt: fr
        ? 'Appelle get_daily_briefing(days_ahead=14) et list_reminders(status="open"). Pour chaque date confirmée sans vol, hôtel ou soundcheck, crée un rappel avec create_reminder.'
        : 'Call get_daily_briefing(days_ahead=14) and list_reminders(status="open"). For any confirmed show missing flights, hotel, or soundcheck, call create_reminder with a clear due date.',
    },
  ];

  return (
    <div id="mcp">
      <div className="sep">
        <span>{fr ? 'Connecter votre app IA mobile (MCP · 1-2-3)' : 'Connect Your Mobile AI App (MCP · Easy 1-2-3 Setup)'}</span>
        <span className="mono sub" style={{ fontSize: 11 }}>
          {hasKey ? (fr ? 'MCP connecté ✓' : 'MCP active ✓') : fr ? 'Claude · ChatGPT · Gemini · Grok' : 'Claude · ChatGPT · Gemini · Grok'}
        </span>
      </div>

      <div className="space-y-3 border-b border-[var(--cv-line)] p-3 text-xs">
        {/* Step 1: Mint personal MCP URL */}
        <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-2.5">
          <div className="space-y-0.5">
            <div className="font-semibold text-[var(--cv-ink)]">
              {fr ? '1. Obtenez votre lien MCP personnel' : '1. Get your personal MCP link'}
            </div>
            <div className="sub" style={{ fontSize: 11 }}>
              {fr
                ? 'Utilisez Tour Designer directement depuis Claude, ChatGPT, Gemini ou Grok sur mobile — vos vols, feuilles de route, rappels et cartes d’embarquement dans le chat.'
                : 'Use Tour Designer from Claude, ChatGPT, Gemini, or Grok on your phone — get boarding passes, hotel vouchers, day sheets, and reminders right in chat.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn--def" disabled={busy} onClick={() => void handleGenerate()}>
              {busy ? '…' : hasKey ? (fr ? 'Régénérer mon lien MCP' : 'Rotate my MCP link') : fr ? 'Créer mon lien MCP' : 'Get my AI link'}
            </button>
            {hasKey && (
              <button type="button" className="btn" disabled={busy} onClick={() => void handleRevoke()}>
                {fr ? 'Révoquer' : 'Revoke'}
              </button>
            )}
          </div>
        </div>

        {errMsg && (
          <div className="warn mono" style={{ fontSize: 11.5, padding: '6px 8px' }}>
            {errMsg}
          </div>
        )}

        {issued && (
          <div className="dk-next space-y-2" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '10px 12px' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>
                {fr
                  ? 'Votre lien MCP privé (affiché une fois — copiez-le maintenant)'
                  : 'Your private MCP link (shown once — copy it now)'}
              </strong>
              <button
                type="button"
                className="btn btn--def"
                style={{ minHeight: 24, padding: '0 10px', fontSize: 11.5 }}
                onClick={() => void copyText('mcp-url', issued.mcp_url)}
              >
                {copiedId === 'mcp-url' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier le lien MCP' : 'Copy MCP link'}
              </button>
            </div>
            <code className="mono sub block break-all border border-[var(--cv-line)] bg-[var(--cv-paper)] px-2 py-1.5 text-[11px]">
              {issued.mcp_url}
            </code>
          </div>
        )}

        {/* Step 2: Pick your AI mobile / desktop app */}
        <div className="space-y-2 border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[var(--cv-ink)]">
              {fr ? '2. Choisissez votre application IA' : '2. Pick your AI app (mobile or desktop)'}
            </span>
            <span className="mono sub" style={{ fontSize: 10.5 }}>
              MCP 2025-03-26 · HTTP + Bearer + Files
            </span>
          </div>

          <div className="segs" role="tablist" aria-label="AI client guides">
            {(
              [
                ['claude', 'Claude'],
                ['chatgpt', 'ChatGPT'],
                ['gemini', 'Gemini'],
                ['grok', 'Grok / Bot / IDE'],
              ] as Array<[ClientTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`seg${tab === id ? ' seg--on' : ''}`}
                style={{ minHeight: 24, padding: '1px 10px', fontSize: 11.5 }}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'claude' && (
            <div className="space-y-2">
              <div className="sub leading-relaxed">
                <strong>Claude (iOS, Android, Web &amp; Desktop):</strong>{' '}
                {fr
                  ? 'Ouvrez Settings → Connectors → Add Custom Connector → collez votre lien MCP. Vos connecteurs se synchronisent aussitôt sur l’app mobile Claude.'
                  : 'Open Settings → Connectors → Add Custom Connector → paste your MCP link. Custom connectors sync straight to the Claude mobile app automatically.'}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="mono flex-1 overflow-x-auto border border-[var(--cv-line)] bg-[var(--cv-paper)] px-2 py-1 text-[11px]">
                  {claudeCodeCmd}
                </code>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                  onClick={() => void copyText('claude-cli', claudeCodeCmd)}
                >
                  {copiedId === 'claude-cli' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier CLI' : 'Copy CLI'}
                </button>
              </div>
            </div>
          )}

          {tab === 'chatgpt' && (
            <div className="space-y-2">
              <div className="sub leading-relaxed">
                <strong>ChatGPT (Mobile App, Web &amp; Scheduled Tasks):</strong>{' '}
                {fr
                  ? 'Settings → Apps & Connectors → Developer Mode → Create MCP Connector → collez votre lien MCP. Activez ensuite des Tasks automatiques pour vos briefings du matin.'
                  : 'Settings → Apps & Connectors → Developer Mode → Create MCP Connector → paste your MCP link. Available right inside the ChatGPT mobile app, plus Scheduled Tasks for daily briefings.'}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="mono flex-1 overflow-x-auto border border-[var(--cv-line)] bg-[var(--cv-paper)] px-2 py-1 text-[11px]">
                  {displayUrl}
                </code>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                  onClick={() => void copyText('chatgpt-url', displayUrl)}
                >
                  {copiedId === 'chatgpt-url' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier lien' : 'Copy link'}
                </button>
              </div>
            </div>
          )}

          {tab === 'gemini' && (
            <div className="space-y-2">
              <div className="sub leading-relaxed">
                <strong>Gemini CLI / Antigravity / Gemini Apps:</strong>{' '}
                {fr
                  ? 'Ajoutez le connecteur HTTP en 1 commande ou collez votre lien MCP dans vos extensions MCP :'
                  : 'Add the Streamable HTTP server in 1 command or paste your MCP link into your Gemini MCP extensions:'}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="mono flex-1 overflow-x-auto border border-[var(--cv-line)] bg-[var(--cv-paper)] px-2 py-1 text-[11px]">
                  {geminiCliCmd}
                </code>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                  onClick={() => void copyText('gemini-cli', geminiCliCmd)}
                >
                  {copiedId === 'gemini-cli' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier CLI' : 'Copy CLI'}
                </button>
              </div>
            </div>
          )}

          {tab === 'grok' && (
            <div className="space-y-2">
              <div className="sub leading-relaxed">
                <strong>Grok / GrokBot / Cursor / Codex / n8n:</strong>{' '}
                {fr
                  ? 'Compatible URL directe (/mcp/<token>) ou Bearer Token (/mcp + Authorization: Bearer <token>) :'
                  : 'Works with either the direct URL (/mcp/<token>) or standard Bearer auth (/mcp + Authorization: Bearer <token>):'}
              </div>
              <div className="relative">
                <pre className="mono m-0 max-h-36 overflow-auto border border-[var(--cv-line)] bg-[var(--cv-paper)] p-2 text-[11px]">
                  {genericJson}
                </pre>
                <button
                  type="button"
                  className="btn"
                  style={{ position: 'absolute', top: 6, right: 6, minHeight: 22, padding: '0 8px', fontSize: 11 }}
                  onClick={() => void copyText('grok-json', genericJson)}
                >
                  {copiedId === 'grok-json' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier JSON' : 'Copy JSON'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Step 3: Ready-to-paste Automation, Boarding Pass & Reminder Prompts */}
        <div className="space-y-1.5">
          <div className="font-semibold text-[var(--cv-ink)]">
            {fr
              ? '3. Essayez dans votre chat IA (cartes d’embarquement, briefings & rappels)'
              : '3. Try these in your AI chat (boarding passes, briefings & reminders)'}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {automationPrompts.map((p) => (
              <div
                key={p.id}
                className="flex flex-col justify-between gap-1.5 border border-[var(--cv-line)] bg-[var(--cv-paper2)] p-2"
              >
                <div>
                  <div className="font-semibold text-[var(--cv-ink)]">{p.title}</div>
                  <p className="sub m-0 mt-0.5 text-[11px] leading-snug">{p.prompt}</p>
                </div>
                <button
                  type="button"
                  className="btn self-start"
                  style={{ minHeight: 22, padding: '0 8px', fontSize: 11 }}
                  onClick={() => void copyText(`prompt-${p.id}`, p.prompt)}
                >
                  {copiedId === `prompt-${p.id}` ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier le prompt' : 'Copy prompt'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
