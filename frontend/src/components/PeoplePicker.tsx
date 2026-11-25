/**
 * Exact prod "Pour qui" multi-select People Picker popover:
 * - Type to filter; typing "tout"/"all" + Enter resets to everyone ([])
 * - Space toggles highlighted person WITHOUT clearing search
 * - Shows crew on this date first, then full directory
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { foldText } from '../lib/smartParse';
import type { Locale, Person } from '../types';

interface Props {
  people: Person[];
  onDateIds: Set<string>;
  selectedIds: string[];
  locale: Locale;
  onSave: (ids: string[]) => void;
  onCancel: () => void;
}

export function PeoplePicker({ people, onDateIds, selectedIds, locale, onSave, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onSave(picked);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [picked, onSave]);

  const ordered = useMemo(() => {
    const q = foldText(query.trim());
    return [...people]
      .sort((a, b) => Number(onDateIds.has(b.id)) - Number(onDateIds.has(a.id)) || a.name.localeCompare(b.name))
      .filter((p) => !q || foldText(`${p.name} ${p.role || ''}`).includes(q));
  }, [people, onDateIds, query]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && ordered.length) {
      e.preventDefault();
      setIdx((i) => (i + 1) % ordered.length);
    } else if (e.key === 'ArrowUp' && ordered.length) {
      e.preventDefault();
      setIdx((i) => (i - 1 + ordered.length) % ordered.length);
    } else if (e.key === ' ' && query.trim() && ordered[idx]) {
      e.preventDefault();
      toggle(ordered[idx].id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = foldText(query.trim());
      if (q === 'tout' || q === 'tous' || q === 'all') {
        onSave([]);
        return;
      }
      if (q && ordered.length === 1 && !picked.includes(ordered[0].id)) {
        onSave([...picked, ordered[0].id]);
        return;
      }
      onSave(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      ref={ref}
      className="win absolute left-0 top-full z-50 mt-0.5 w-64"
      style={{ background: 'var(--cv-paper)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="border-b border-[var(--cv-line2)] p-1.5">
        <input
          className="in"
          style={{ minHeight: 26 }}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
          onKeyDown={onKey}
          placeholder={locale === 'fr' ? 'Filtrer ou taper "tout"…' : 'Filter or type "all"…'}
          autoFocus
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        <button
          type="button"
          className={`day${picked.length === 0 ? ' day--on' : ''}`}
          style={{ gridTemplateColumns: '18px minmax(0, 1fr)' }}
          onClick={() => onSave([])}
        >
          <span>{picked.length === 0 ? '✓' : ''}</span>
          <span><b>{locale === 'fr' ? 'Toute l’équipe' : 'Everyone'}</b></span>
        </button>
        {ordered.map((p, i) => {
          const checked = picked.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`day${i === idx ? ' day--on' : ''}`}
              style={{ gridTemplateColumns: '18px minmax(0, 1fr) auto' }}
              onClick={() => toggle(p.id)}
            >
              <span>{checked ? '☑' : '☐'}</span>
              <span className="truncate">{p.name}</span>
              <span className="sub" style={i === idx ? { color: 'var(--cv-selink)' } : undefined}>
                {p.role || ''}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--cv-line2)] bg-[var(--cv-chrome2)] px-2 py-1 text-xs">
        <span className="sub">Space · Enter</span>
        <button type="button" className="btn btn--def" style={{ minHeight: 22 }} onClick={() => onSave(picked)}>
          OK
        </button>
      </div>
    </div>
  );
}
