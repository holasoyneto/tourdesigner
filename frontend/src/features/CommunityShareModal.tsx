import { useEffect, useRef, useState } from 'react';
import type { CommunityShareConfig } from '../api/client';
import { fullUrl } from '../lib/basePath';
import type { Locale } from '../types';

interface Props {
  mode: 'milestone' | 'invite';
  gigsCount: number;
  community: CommunityShareConfig;
  locale: Locale;
  onClose: () => void;
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vrot: number;
  color: string;
}

const CONFETTI_COLORS = ['#f3c64a', '#6ea8fe', '#5fd39f', '#ff7a7a', '#f8fafc', '#c084fc'];

export function CommunityShareModal({ mode, gigsCount, community, locale, onClose }: Props) {
  const fr = locale === 'fr';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState<'link' | 'btc' | 'ln' | null>(null);

  const shareUrl = community.share_url || fullUrl('/');
  const shareText = fr
    ? `Je gère mes feuilles de route avec Tour Designer — hors ligne, rapide et gratuit en bêta : ${shareUrl}`
    : `Running my tour sheets on Tour Designer — offline-first, fast, and free in beta: ${shareUrl}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tasteful, lightweight 60fps confetti burst on milestone only (respects prefers-reduced-motion)
  useEffect(() => {
    if (mode !== 'milestone') return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const pieces: ConfettiPiece[] = Array.from({ length: 84 }, (_, idx) => {
      const fromLeft = idx % 2 === 0;
      return {
        x: fromLeft ? window.innerWidth * (0.15 + Math.random() * 0.35) : window.innerWidth * (0.5 + Math.random() * 0.35),
        y: -16 - Math.random() * 140,
        vx: (Math.random() - 0.5) * 3.2,
        vy: 1.8 + Math.random() * 3.2,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.16,
        color: CONFETTI_COLORS[idx % CONFETTI_COLORS.length],
      };
    });

    const start = performance.now();
    const durationMs = 3800;
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= durationMs) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        return;
      }
      const alpha = elapsed > 2800 ? Math.max(0, 1 - (elapsed - 2800) / 1000) : 0.92;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalAlpha = alpha;
      for (const p of pieces) {
        p.x += p.vx + Math.sin(elapsed / 260 + p.rot) * 0.45;
        p.y += p.vy;
        p.vy = Math.min(p.vy + 0.045, 5.2);
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [mode]);

  async function copyValue(kind: 'link' | 'btc' | 'ln', value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(kind);
    window.setTimeout(() => setCopied((cur) => (cur === kind ? null : cur)), 2000);
  }

  async function handleNativeShare() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Tour Designer',
          text: fr
            ? 'Feuilles de route de tournée hors ligne, rapides et gratuites en bêta.'
            : 'Offline-first tour sheets for DJs, artists, and tour managers — free in beta.',
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or share sheet unavailable — fall through to copy
      }
    }
    await copyValue('link', shareUrl);
  }

  const hasBtc = Boolean(community.btc_address || community.lightning_address);
  const waHref = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(fr ? 'Tour Designer — feuilles de route de tournée' : 'Tour Designer — clean tour sheets for the road')}&body=${encodeURIComponent(shareText)}`;
  const xHref = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'milestone' ? (fr ? 'Merci pour votre confiance' : 'Thank you for touring with us') : fr ? 'Partager Tour Designer' : 'Share Tour Designer'}
    >
      {mode === 'milestone' && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 51 }}
        />
      )}

      <div
        className="relative w-full max-w-md"
        style={{ zIndex: 52 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ytab">
          <button type="button" className="box" onClick={onClose} title={fr ? 'Fermer' : 'Close'} />
          <span>
            {mode === 'milestone'
              ? fr
                ? `★ ${gigsCount} dates planifiées — merci !`
                : `★ ${gigsCount} dates on the road — thank you!`
              : fr
                ? 'Inviter un DJ, artiste ou tour manager'
                : 'Share with a fellow DJ or Tour Manager'}
          </span>
        </div>

        <div className="win space-y-3 p-4">
          {mode === 'milestone' ? (
            <div className="space-y-1.5">
              <h2 className="m-0 text-sm font-bold text-[var(--cv-ink)]">
                {fr ? 'Merci infiniment pour votre confiance.' : 'Thank you so much for trusting Tour Designer.'}
              </h2>
              <p className="sub m-0 text-xs leading-relaxed">
                {fr
                  ? `Vous avez déjà organisé ${gigsCount} dates ici. Nous gardons la bêta gratuite pour les artistes indépendants, DJs et tour managers — si l’outil vous fait gagner des heures sur la route, partagez-le avec un collègue.`
                  : `You’ve already planned ${gigsCount} dates here. We’re keeping the beta free for independent artists, DJs, and tour managers — if it’s saving you hours on the road, pass it along to someone who needs it.`}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <h2 className="m-0 text-sm font-bold text-[var(--cv-ink)]">
                {fr ? 'Faites découvrir Tour Designer' : 'Pass Tour Designer along'}
              </h2>
              <p className="sub m-0 text-xs leading-relaxed">
                {fr
                  ? 'Un lien direct vers la bêta gratuite — feuilles de route hors ligne, multi-projets et import IA inclus.'
                  : 'Send a direct link to the free beta — offline day sheets, multi-artist agendas, and AI intake included.'}
              </p>
            </div>
          )}

          {/* Share link bar */}
          <div className="space-y-2 border border-[var(--cv-line2)] bg-[var(--cv-paper)] p-2.5">
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                className="in mono flex-1 text-xs"
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={fr ? 'Lien de partage' : 'Share link'}
              />
              <button
                type="button"
                className="btn btn--def"
                onClick={() => void copyValue('link', shareUrl)}
              >
                {copied === 'link' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier' : 'Copy link'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button type="button" className="btn" style={{ minHeight: 24, fontSize: 11.5 }} onClick={() => void handleNativeShare()}>
                  {fr ? 'Partager…' : 'Share…'}
                </button>
              )}
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ minHeight: 24, fontSize: 11.5, textDecoration: 'none' }}
              >
                WhatsApp
              </a>
              <a
                href={xHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ minHeight: 24, fontSize: 11.5, textDecoration: 'none' }}
              >
                X / Twitter
              </a>
              <a
                href={mailHref}
                className="btn"
                style={{ minHeight: 24, fontSize: 11.5, textDecoration: 'none' }}
              >
                Email
              </a>
            </div>
          </div>

          {/* Optional Bitcoin / Lightning tip jar (only rendered when host configures an address) */}
          {hasBtc && (
            <div className="space-y-2 border border-[var(--cv-line2)] bg-[var(--cv-paper)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="lab" style={{ fontWeight: 700 }}>
                  ₿ {fr ? 'Soutenir l’équipe en Bitcoin (optionnel)' : 'Support the team with Bitcoin (optional)'}
                </span>
                <span className="sub" style={{ fontSize: 10.5 }}>
                  {fr ? 'Serveurs & IA gratuite' : 'Helps fund cloud & free AI'}
                </span>
              </div>

              {community.btc_address && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="mono sub flex-1 truncate border border-[var(--cv-line)] bg-[var(--cv-paper2)] px-2 py-1 text-[11px]">
                    {community.btc_address}
                  </code>
                  <button
                    type="button"
                    className="btn"
                    style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                    onClick={() => void copyValue('btc', community.btc_address)}
                  >
                    {copied === 'btc' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier BTC' : 'Copy BTC'}
                  </button>
                  <a
                    href={`bitcoin:${encodeURIComponent(community.btc_address)}`}
                    className="btn"
                    style={{ minHeight: 24, padding: '0 8px', fontSize: 11, textDecoration: 'none' }}
                  >
                    {fr ? 'Wallet' : 'Wallet'}
                  </a>
                </div>
              )}

              {community.lightning_address && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="mono sub flex-1 truncate border border-[var(--cv-line)] bg-[var(--cv-paper2)] px-2 py-1 text-[11px]">
                    ⚡ {community.lightning_address}
                  </code>
                  <button
                    type="button"
                    className="btn"
                    style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                    onClick={() => void copyValue('ln', community.lightning_address)}
                  >
                    {copied === 'ln' ? (fr ? 'Copié ✓' : 'Copied ✓') : 'Copy ⚡'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="sub" style={{ fontSize: 11 }}>
              {mode === 'milestone'
                ? fr
                  ? 'Affiché une seule fois — jamais de relance.'
                  : 'Shown once — never nags again.'
                : fr
                  ? 'Merci de faire grandir la communauté.'
                  : 'Thanks for spreading the word.'}
            </span>
            <button type="button" className="btn" onClick={onClose}>
              {mode === 'milestone' ? (fr ? 'Retour à la tournée' : 'Back to touring') : fr ? 'Fermer' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
