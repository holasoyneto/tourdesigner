/**
 * Runtime subpath helper driven by `<meta name="td-base" content="..." />`.
 * Enables the same static bundle to run cleanly at `/` or any reverse-proxied subpath (e.g. `/tourdesigner`).
 */

function readBasePath(): string {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="td-base"]')?.getAttribute('content') || '';
  const clean = meta.trim();
  if (!clean || clean === '/') return '';
  return '/' + clean.replace(/^\/+|\/+$/g, '');
}

export const BASE_PATH = readBasePath();

export function withBase(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!BASE_PATH) return normalized;
  if (normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)) return normalized;
  return `${BASE_PATH}${normalized}`;
}

export function stripBase(pathname: string): string {
  if (!BASE_PATH) return pathname || '/';
  if (pathname === BASE_PATH) return '/';
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length) || '/';
  return pathname || '/';
}

export function fullUrl(path: string): string {
  return `${window.location.origin}${withBase(path)}`;
}

const demoFileUrls = new Map<string, string>();

export function registerDemoFileUrl(fileId: string, url: string): void {
  demoFileUrls.set(fileId, url);
}

export function clearDemoFileUrls(): void {
  demoFileUrls.clear();
}

export function fileAssetUrl(fileId: string, inline = true): string {
  const demo = demoFileUrls.get(fileId);
  if (demo) return demo;
  return withBase(`/api/files/${encodeURIComponent(fileId)}/download${inline ? '?inline=1' : ''}`);
}
