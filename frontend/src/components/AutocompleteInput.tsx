import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface SuggestionOption {
  value: string;
  label: string;
  sub?: string;
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  onCommit: (val: string, chosen?: SuggestionOption) => void;
  onCancel?: () => void;
  suggestions: SuggestionOption[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** True for ephemeral single-cell spreadsheet editors (commits on outside click); false for persistent form inputs inside modals. */
  inlineCell?: boolean;
}

export function AutocompleteInput({
  value,
  onChange,
  onCommit,
  onCancel,
  suggestions,
  placeholder,
  className = '',
  autoFocus = true,
  inlineCell = true,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(inlineCell && autoFocus);
  const [navigated, setNavigated] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIdx(0);
    setNavigated(false);
  }, [value, suggestions.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (inlineCell) onCommit(value);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [value, onCommit, inlineCell]);

  function selectOption(opt: SuggestionOption) {
    setOpen(false);
    setNavigated(false);
    onCommit(opt.value, opt);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setIdx(0);
        setNavigated(true);
      } else {
        setIdx((i) => (i + 1) % suggestions.length);
        setNavigated(true);
      }
      return;
    }

    if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setIdx(suggestions.length - 1);
        setNavigated(true);
      } else {
        setIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        setNavigated(true);
      }
      return;
    }

    if (e.key === 'Enter') {
      if (inlineCell) {
        e.preventDefault();
        const pick = open && suggestions[idx];
        setOpen(false);
        if (pick) onCommit(pick.value, pick);
        else onCommit(value);
      } else if (open && suggestions.length > 0 && (navigated || value.trim().length > 0)) {
        // Pick highlighted option and stay safely inside the modal without accidental form submit
        e.preventDefault();
        e.stopPropagation();
        selectOption(suggestions[idx]);
      } else {
        // Close dropdown and let user use ⌘↵ or click Add (prevent accidental bare Enter submit inside form fields)
        e.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (e.key === 'Tab') {
      if (inlineCell) {
        e.preventDefault();
        const pick = open && suggestions[idx];
        setOpen(false);
        if (pick) onCommit(pick.value, pick);
        else onCommit(value);
      } else {
        // In modal forms, NEVER trap Tab! If user navigated with arrows, accept pick then let focus move naturally.
        if (open && navigated && suggestions[idx]) {
          selectOption(suggestions[idx]);
        } else {
          setOpen(false);
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      if (!inlineCell && open) {
        // Close only this dropdown first; second Escape closes the modal
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else {
        e.preventDefault();
        setOpen(false);
        onCancel?.();
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        className={`in ${className}`}
        style={inlineCell ? { minHeight: 24, padding: '2px 6px' } : undefined}
        value={value}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Small delay lets onMouseDown on option buttons fire cleanly before closing
          window.setTimeout(() => setOpen(false), 120);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div
          className="win absolute left-0 top-full z-50 mt-0.5 max-h-52 w-full min-w-[210px] overflow-y-auto"
          style={{ background: 'var(--cv-paper)', boxShadow: '0 8px 22px rgba(0,0,0,0.32)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.value}-${i}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(s);
              }}
              className={`day${i === idx ? ' day--on' : ''}`}
              style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', minHeight: 26, padding: '4px 8px' }}
            >
              <span className="truncate">{s.label}</span>
              {s.sub && (
                <span className="mono sub" style={i === idx ? { color: 'var(--cv-selink)' } : undefined}>
                  {s.sub}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
