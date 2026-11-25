import {
  Bot,
  Building2,
  Car,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  Link2,
  ListMusic,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Music,
  Pencil,
  Phone,
  Plane,
  Plus,
  Share2,
  Square,
  StickyNote,
  Train,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useState, type RefObject } from 'react';
import { api } from '../api/client';
import { fileAssetUrl } from '../lib/basePath';
import type { SuggestionOption } from '../components/AutocompleteInput';
import { SmartQuickAdd } from '../components/SmartQuickAdd';
import type { CopyDict } from '../i18n/copy';
import {
  formatClock,
  formatDayPlainText,
  parseLineupPaste,
  STATUS_LABELS,
  type GapInfo,
} from '../lib/smartParse';
import type { ParsedQuickAdd } from '../lib/smartQuickAdd';
import type { TourSyncState } from '../offline/sync';
import type { FileRecord, Gig, GigItem, ItemCollection, Locale, Person } from '../types';

export type MobileRowKind = 'flight' | 'train' | 'ground' | 'hotel' | 'schedule' | 'set';

export interface MobileTimelineRow {
  key: string;
  item?: GigItem;
  sortKey: string;
  startTime?: string | null;
  endTime?: string | null;
  isTravel: boolean;
  isHotel: boolean;
  iconKind: MobileRowKind;
  time: string;
  what: string;
  where: string;
  who: string;
  note: string;
  facts: Array<[string, string]>;
  refCode?: string;
  mapsQuery?: string;
  phone?: string;
}

type MobileTab = 'schedule' | 'crew' | 'order' | 'rider' | 'notes';

interface Props {
  gig: Gig;
  items: GigItem[];
  allGigs: Gig[];
  people: Person[];
  files: FileRecord[];
  setFiles: React.Dispatch<React.SetStateAction<FileRecord[]>>;
  timeline: MobileTimelineRow[];
  gapsAfter: Record<string, GapInfo>;
  nextRow: MobileTimelineRow | null;
  byCol: Record<string, GigItem[]>;
  onDatePersonIds: Set<string>;
  placeSuggestions: SuggestionOption[];
  activitySuggestions: SuggestionOption[];
  latestMcpBatch: { batchId: string; actor: string; count: number } | null;
  canEdit: boolean;
  isOwner: boolean;
  locale: Locale;
  copy: CopyDict;
  sync: TourSyncState;
  copiedKey: string | null;
  flashCopy: (key: string, text: string) => void;
  quickAddInputRef: RefObject<HTMLInputElement | null>;
  viewMineOnly: boolean;
  myPersonId: string | null;
  onToggleMine: () => void;
  onNavigate?: (path: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenHeaderEditor: () => void;
  onOpenRowEditorAdd: (collection: 'flights' | 'transport' | 'hotels' | 'schedule', presetTime?: string) => void;
  onOpenRowEditorEdit: (item: GigItem) => void;
  onOpenRowEditorParsed: (p: ParsedQuickAdd) => void;
  onQuickAddCommit: (collection: ItemCollection, data: Record<string, unknown>, personIds: string[], label: string) => Promise<void>;
  onDuplicateItem: (item: GigItem) => Promise<void>;
  onRemoveItem: (item: GigItem, label: string) => Promise<void>;
  onOpenIntake: () => void;
  onShare: (scope: 'gig_master' | 'gig_crew', personId?: string, label?: string) => Promise<void>;
  onLifecycleRequest: (kind: 'archive' | 'trash') => void;
  say: (text: string, warn?: boolean) => void;
}

function KindIcon({ kind, className = 'h-3.5 w-3.5' }: { kind: MobileRowKind; className?: string }) {
  if (kind === 'flight') return <Plane className={className} />;
  if (kind === 'train') return <Train className={className} />;
  if (kind === 'ground') return <Car className={className} />;
  if (kind === 'hotel') return <Building2 className={className} />;
  if (kind === 'set') return <Music className={className} />;
  return <Clock className={className} />;
}

function mapsHref(query: string, city: string): string {
  const q = city && !query.toLowerCase().includes(city.toLowerCase()) ? `${query} ${city}` : query;
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
}

function shortDayHeader(iso: string, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const s = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clockRangeCompact(start?: string | null, end?: string | null, locale: Locale = 'en'): string {
  const s = start ? formatClock(start, locale) : '';
  const e = end ? formatClock(end, locale) : '';
  if (s && e && e !== s) return `${s}–${e}`;
  return s || '—';
}

export function MobileDaySheet(props: Props) {
  const {
    gig,
    items,
    allGigs,
    people,
    files,
    setFiles,
    timeline,
    gapsAfter,
    nextRow,
    byCol,
    onDatePersonIds,
    placeSuggestions,
    activitySuggestions,
    latestMcpBatch,
    canEdit,
    isOwner,
    locale,
    copy,
    sync,
    copiedKey,
    flashCopy,
    quickAddInputRef,
    viewMineOnly,
    myPersonId,
    onToggleMine,
    onNavigate,
    onOpenFile,
    onOpenHeaderEditor,
    onOpenRowEditorAdd,
    onOpenRowEditorEdit,
    onOpenRowEditorParsed,
    onQuickAddCommit,
    onDuplicateItem,
    onRemoveItem,
    onOpenIntake,
    onShare,
    onLifecycleRequest,
    say,
  } = props;

  const fr = locale === 'fr';
  const [tab, setTab] = useState<MobileTab>('schedule');
  const [sheetRowKey, setSheetRowKey] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(gig.notes || '');
  const [riderText, setRiderText] = useState('');
  const [orderPasteOpen, setOrderPasteOpen] = useState(false);
  const [orderPasteText, setOrderPasteText] = useState('');

  // Prev / Next active tour dates for 1-tap hardware stepping
  const orderedGigs = allGigs
    .filter((g) => !g.archived && !g.deleted_at)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const curIdx = orderedGigs.findIndex((g) => g.id === gig.id);
  const prevGig = curIdx > 0 ? orderedGigs[curIdx - 1] : null;
  const nextGig = curIdx >= 0 && curIdx < orderedGigs.length - 1 ? orderedGigs[curIdx + 1] : null;

  const sheetRow = sheetRowKey ? timeline.find((r) => r.key === sheetRowKey) || null : null;
  const crewAndContacts = [...(byCol.crew || []), ...(byCol.contacts || [])];
  const guests = byCol.guests || [];
  const timetable = byCol.timetable || [];
  const rider = byCol.rider || [];
  const links = byCol.links || [];

  const nextPhone = nextRow?.phone || '';
  const nextPhoneDigits = nextPhone.replace(/[^\d+]/g, '');
  const nextWaDigits = nextPhoneDigits.replace(/^\+/, '');

  const tabs: Array<{ id: MobileTab; label: string; count?: number; icon: typeof Clock }> = [
    { id: 'schedule', label: fr ? 'Programme' : 'Day', count: timeline.length, icon: Clock },
    { id: 'crew', label: fr ? 'Équipe' : 'Crew', count: crewAndContacts.length + guests.length, icon: Users },
    { id: 'order', label: 'Lineup', count: timetable.length, icon: ListMusic },
    { id: 'rider', label: 'Rider', count: rider.length, icon: ClipboardList },
    { id: 'notes', label: fr ? 'Docs' : 'Docs', count: files.length + (gig.notes ? 1 : 0), icon: StickyNote },
  ];

  return (
    <div className="m2032-day">
      {/* 1. 2032 Telemetry Date Strip with 1-tap Date Stepper & Overflow Menu */}
      <div className="m2032-datestrip">
        <button
          type="button"
          className="m2032-step"
          disabled={!prevGig}
          title={prevGig ? prevGig.city : undefined}
          onClick={() => prevGig && onNavigate?.(`/gig/${prevGig.id}`)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="m2032-datestrip__mid">
          <div className="m2032-datestrip__top">
            <strong className="m2032-date">{shortDayHeader(gig.date, locale)}</strong>
            <span className="m2032-status">{STATUS_LABELS[locale][gig.status]}</span>
            {gig.set_time && (
              <span className="mono m2032-setpill">
                SET {clockRangeCompact(gig.set_time, gig.set_end, locale)}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="m2032-step"
          disabled={!nextGig}
          title={nextGig ? nextGig.city : undefined}
          onClick={() => nextGig && onNavigate?.(`/gig/${nextGig.id}`)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="m2032-step"
            aria-label={fr ? 'Actions' : 'Actions'}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {moreOpen && (
            <div className="win dk-popmenu" style={{ right: 0, minWidth: 224 }} onClick={() => setMoreOpen(false)}>
              {canEdit && (
                <button type="button" className="item dk-tool" onClick={onOpenHeaderEditor}>
                  {fr ? 'Infos de la date' : 'Edit date info'}
                </button>
              )}
              <button type="button" className="item dk-tool" onClick={() => flashCopy('copy_day', formatDayPlainText(gig, items, people, locale))}>
                {copiedKey === 'copy_day' ? copy.copied : fr ? 'Copier la journée (WhatsApp)' : 'Copy day sheet (WhatsApp)'}
              </button>
              {canEdit && (
                <button type="button" className="item dk-tool" onClick={() => void onShare('gig_master')}>
                  {copiedKey === 'share_master' ? copy.copied : fr ? 'Copier lien voyageur' : 'Copy traveler link'}
                </button>
              )}
              <button type="button" className="item dk-tool" onClick={() => onNavigate?.(`/print?gig=${encodeURIComponent(gig.id)}`)}>
                {fr ? 'Feuille de route A4 / PDF' : 'Print A4 roadsheet'}
              </button>
              {canEdit && (
                <button type="button" className="item dk-tool" onClick={onOpenIntake}>
                  ✨ {fr ? 'Importer email / PDF (AI)' : 'Import email / PDF (AI)'}
                </button>
              )}
              {myPersonId && (
                <button type="button" className="item dk-tool" onClick={onToggleMine}>
                  {viewMineOnly ? (fr ? 'Afficher toute l’équipe' : 'Show full crew') : fr ? 'Mes trajets uniquement' : 'My legs only'}
                </button>
              )}
              {isOwner && (
                <>
                  <button type="button" className="item dk-tool" onClick={() => onLifecycleRequest('archive')}>
                    {fr ? 'Archiver la date' : 'Archive date'}
                  </button>
                  <button type="button" className="item dk-tool warn" onClick={() => onLifecycleRequest('trash')}>
                    {fr ? 'Mettre à la corbeille' : 'Move to trash'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. Scrollable 2032 Handheld Cockpit Body */}
      <div className="m2032-scroll">
        {/* Hero UP NEXT Boarding-Pass Module */}
        {nextRow && tab === 'schedule' && (
          <section className="m2032-hero" onClick={() => setSheetRowKey(nextRow.key)}>
            <div className="m2032-hero__top">
              <span className="m2032-hero__kicker">
                <i className="m2032-led" />
                {fr ? 'À SUIVRE' : 'UP NEXT'}
              </span>
              <span className="mono m2032-hero__clock">{nextRow.time}</span>
            </div>

            <div className="m2032-hero__title">
              <span className={`m2032-kind m2032-kind--${nextRow.iconKind}`}>
                <KindIcon kind={nextRow.iconKind} className="h-4 w-4" />
              </span>
              <span className="truncate">{nextRow.what}</span>
            </div>

            {(nextRow.where || nextRow.note) && (
              <div className="m2032-hero__sub">
                {[nextRow.where, nextRow.note].filter(Boolean).join(' · ')}
              </div>
            )}

            <div className="m2032-hero__acts" onClick={(e) => e.stopPropagation()}>
              {nextRow.refCode ? (
                <button
                  type="button"
                  className="btn btn--def m2032-hero__cta"
                  onClick={() => flashCopy('hero_ref', nextRow.refCode!)}
                >
                  {copiedKey === 'hero_ref' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === 'hero_ref' ? copy.copied : `${fr ? 'Copier' : 'Copy'} ${nextRow.refCode}`}
                </button>
              ) : nextPhoneDigits ? (
                <a className="btn btn--def m2032-hero__cta" href={`tel:${nextPhoneDigits}`}>
                  <Phone className="h-3.5 w-3.5" /> {fr ? 'Appeler' : 'Call'}
                </a>
              ) : null}

              {nextWaDigits.length >= 7 && (
                <a className="btn m2032-hero__btn" href={`https://wa.me/${nextWaDigits}`} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}

              {(nextRow.mapsQuery || nextRow.where) && (
                <a
                  className="btn m2032-hero__btn"
                  href={mapsHref(nextRow.mapsQuery || nextRow.where, gig.city)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-3.5 w-3.5" /> Maps
                </a>
              )}

              <button type="button" className="btn m2032-hero__btn" onClick={() => setSheetRowKey(nextRow.key)}>
                {fr ? 'Détails' : 'Details'}
              </button>
            </div>
          </section>
        )}

        {/* MCP Attribution Undo Banner */}
        {latestMcpBatch && canEdit && tab === 'schedule' && (
          <div className="m2032-mcp">
            <span className="truncate inline-flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 shrink-0" />
              <b>{latestMcpBatch.actor}</b> {copy.viaAssistant} ({latestMcpBatch.count})
            </span>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 26, padding: '0 8px', fontSize: 11.5 }}
              onClick={() => void api.undoBatch(gig.id, latestMcpBatch.batchId).then(() => sync.refreshFull())}
            >
              <Undo2 className="h-3 w-3" /> {fr ? 'Annuler' : 'Undo'}
            </button>
          </div>
        )}

        {/* Sticky 5-Tab Hardware Mode Switcher */}
        <div className="m2032-tabs" role="tablist">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`m2032-tab${on ? ' m2032-tab--on' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
                {typeof t.count === 'number' && t.count > 0 && (
                  <span className="mono m2032-tab__n">{t.count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* TAB 1: 2032 TACTILE TIMELINE CARDS */}
        {tab === 'schedule' && (
          <div className="m2032-timeline">
            {timeline.length === 0 ? (
              <div className="m2032-empty">
                <p className="sub">{fr ? 'Aucune ligne pour cette date.' : 'Nothing scheduled yet.'}</p>
                {canEdit && (
                  <button type="button" className="btn btn--def" onClick={() => onOpenRowEditorAdd('flights')}>
                    <Plus className="h-3.5 w-3.5" /> {fr ? 'Ajouter un vol ou horaire' : 'Add flight or schedule'}
                  </button>
                )}
              </div>
            ) : (
              timeline.map((row) => {
                const gap = gapsAfter[row.key];
                const phoneDigits = (row.phone || '').replace(/[^\d+]/g, '');
                const waDigits = phoneDigits.replace(/^\+/, '');
                const parts = row.time.split('–');
                return (
                  <div key={row.key}>
                    <article
                      className={`m2032-card m2032-card--${row.iconKind}`}
                      onClick={() => setSheetRowKey(row.key)}
                    >
                      <div className="m2032-card__rail">
                        <span className="mono m2032-card__t1">{parts[0] || '—'}</span>
                        {parts[1] && <span className="mono m2032-card__t2">{parts[1]}</span>}
                        <span className={`m2032-railbar m2032-railbar--${row.iconKind}`} />
                      </div>

                      <div className="m2032-card__body">
                        <div className="m2032-card__head">
                          <span className={`m2032-kind m2032-kind--${row.iconKind}`}>
                            <KindIcon kind={row.iconKind} className="h-3.5 w-3.5" />
                          </span>
                          <strong className="m2032-card__title">{row.what}</strong>
                        </div>

                        {(row.where || row.note) && (
                          <div className="m2032-card__sub">
                            {[row.where, row.note].filter(Boolean).join(' · ')}
                          </div>
                        )}

                        <div className="m2032-card__meta">
                          <span className="m2032-who">{row.who}</span>

                          {/* 1-tap inline quick actions right on the card! */}
                          <div className="m2032-card__quick" onClick={(e) => e.stopPropagation()}>
                            {row.refCode && (
                              <button
                                type="button"
                                className="m2032-qbtn mono"
                                onClick={() => flashCopy(`card_${row.key}`, row.refCode!)}
                              >
                                {copiedKey === `card_${row.key}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                {row.refCode}
                              </button>
                            )}
                            {phoneDigits.length >= 7 && (
                              <>
                                <a className="m2032-qicon" href={`tel:${phoneDigits}`} aria-label={fr ? 'Appeler' : 'Call'}>
                                  <Phone className="h-3.5 w-3.5" />
                                </a>
                                <a className="m2032-qicon" href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                                  <MessageCircle className="h-3.5 w-3.5" />
                                </a>
                              </>
                            )}
                            {!phoneDigits && !row.refCode && (row.mapsQuery || row.where) && (
                              <a
                                className="m2032-qicon"
                                href={mapsHref(row.mapsQuery || row.where, gig.city)}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Maps"
                              >
                                <MapPin className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>

                    {/* Telemetry Gap Connector */}
                    {gap && (
                      <button
                        type="button"
                        className={`m2032-gap${gap.tight ? ' m2032-gap--tight' : ''}`}
                        onClick={() => canEdit && onOpenRowEditorAdd('schedule', row.endTime || row.startTime || '')}
                      >
                        <span className="m2032-gap__line" />
                        <span className="m2032-gap__label">{gap.label}</span>
                        {canEdit && <span className="m2032-gap__add">+</span>}
                        <span className="m2032-gap__line" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: CREW, CONTACTS & GUESTLIST */}
        {tab === 'crew' && (
          <div className="m2032-pane">
            {crewAndContacts.map((c) => {
              const phone = String(c.data.phone || '');
              const digits = phone.replace(/[^\d+]/g, '');
              const wa = digits.replace(/^\+/, '');
              const pid = c.person_ids[0];
              return (
                <div key={c.id} className="m2032-pcard">
                  <div className="min-w-0 flex-1">
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{String(c.data.name || '')}</div>
                    {Boolean(c.data.role) && <div className="sub" style={{ fontSize: 12 }}>{String(c.data.role)}</div>}
                    {phone && <div className="mono sub" style={{ fontSize: 12, marginTop: 2 }}>{phone}</div>}
                  </div>
                  <div className="m2032-pcard__acts">
                    {digits.length >= 7 && (
                      <>
                        <a className="m2032-qicon" href={`tel:${digits}`} aria-label={fr ? 'Appeler' : 'Call'}>
                          <Phone className="h-4 w-4" />
                        </a>
                        <a className="m2032-qicon" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </>
                    )}
                    {canEdit && c.collection === 'crew' && pid && (
                      <button
                        type="button"
                        className="m2032-qicon"
                        aria-label={fr ? 'Lien personnel' : 'Personal link'}
                        onClick={() => void onShare('gig_crew', pid, `${String(c.data.name)} — ${gig.city}`)}
                      >
                        {copiedKey === pid ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {guests.length > 0 && (
              <>
                <div className="sep">
                  <span>{copy.guests}</span>
                  <span className="mono">{guests.length}</span>
                </div>
                {guests.map((g) => (
                  <div key={g.id} className="m2032-pcard">
                    <div>
                      <strong>{String(g.data.name || '')}</strong>{' '}
                      <span className="m2032-status">{String(g.data.pass_type || '+1')}</span>
                    </div>
                    <span className="sub mono" style={{ fontSize: 11.5 }}>{String(g.data.status || '')}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* TAB 3: RUNNING ORDER / LINEUP */}
        {tab === 'order' && (
          <div className="m2032-pane">
            {timetable.length === 0 ? (
              <p className="sub" style={{ padding: 16 }}>{fr ? 'Aucun running order.' : 'No running order yet.'}</p>
            ) : (
              timetable.map((t) => {
                const isUs = Boolean(t.data.is_us);
                return (
                  <div key={t.id} className={`m2032-slot${isUs ? ' m2032-slot--us' : ''}`}>
                    <span className="mono m2032-slot__time">
                      {clockRangeCompact(String(t.data.start || ''), String(t.data.end || ''), locale)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong>{isUs ? '★ ' : ''}{String(t.data.act || '')}</strong>
                      {Boolean(t.data.stage) && <div className="sub" style={{ fontSize: 11.5 }}>{String(t.data.stage)}</div>}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        className="m2032-qicon"
                        onClick={() => void sync.updateGigItem(gig.id, t.id, { is_us: !isUs })}
                        title={fr ? 'Notre set' : 'Our set'}
                      >
                        {isUs ? '★' : '☆'}
                      </button>
                    )}
                  </div>
                );
              })
            )}

            {canEdit && (
              <div style={{ padding: 12 }}>
                <button type="button" className="btn w-full" onClick={() => setOrderPasteOpen((v) => !v)}>
                  {fr ? 'Coller un lineup complet' : 'Paste full lineup'}
                </button>
                {orderPasteOpen && (
                  <div className="space-y-2 pt-2">
                    <textarea
                      className="in mono"
                      rows={4}
                      value={orderPasteText}
                      onChange={(e) => setOrderPasteText(e.target.value)}
                      placeholder={'23:30-02:00 Warmup\n02:00-04:00 Main Act\n04:00-06:00 Closing'}
                    />
                    <button
                      type="button"
                      className="btn btn--def w-full"
                      onClick={async () => {
                        const parsed = parseLineupPaste(orderPasteText);
                        for (const slot of parsed) {
                          await sync.addGigItem(gig.id, 'timetable', slot);
                        }
                        setOrderPasteText('');
                        setOrderPasteOpen(false);
                        say(fr ? `${parsed.length} créneau(x) importé(s)` : `Imported ${parsed.length} slot(s)`);
                      }}
                    >
                      {fr ? 'Importer' : 'Import'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: RIDER CHECKLIST */}
        {tab === 'rider' && (
          <div className="m2032-pane">
            {rider.map((r) => {
              const done = Boolean(r.data.fulfilled);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!canEdit}
                  className={`m2032-check${done ? ' m2032-check--done' : ''}`}
                  onClick={() => void sync.updateGigItem(gig.id, r.id, { fulfilled: !done })}
                >
                  {done ? <CheckSquare className="h-4 w-4 shrink-0" /> : <Square className="h-4 w-4 shrink-0" />}
                  <div className="text-left">
                    {Boolean(r.data.category) && (
                      <div className="lab" style={{ fontSize: 10 }}>{String(r.data.category)}</div>
                    )}
                    <div>{String(r.data.items || '')}</div>
                  </div>
                </button>
              );
            })}
            {canEdit && (
              <form
                style={{ display: 'flex', gap: 6, padding: 12 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!riderText.trim()) return;
                  await sync.addGigItem(gig.id, 'rider', { category: 'booth', items: riderText.trim(), fulfilled: false });
                  setRiderText('');
                }}
              >
                <input
                  className="in"
                  value={riderText}
                  onChange={(e) => setRiderText(e.target.value)}
                  placeholder={fr ? 'Ex: 3x CDJ-3000 + DJM-A9…' : 'e.g. 3x CDJ-3000 + DJM-A9…'}
                />
                <button type="submit" className="btn btn--def">+</button>
              </form>
            )}
          </div>
        )}

        {/* TAB 5: DOCS, NOTES & SHARE */}
        {tab === 'notes' && (
          <div className="m2032-pane" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => flashCopy('copy_day_m', formatDayPlainText(gig, items, people, locale))}
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedKey === 'copy_day_m' ? copy.copied : fr ? 'Copier texte' : 'Copy text'}
              </button>
              {canEdit && (
                <button type="button" className="btn btn--def" onClick={() => void onShare('gig_master')}>
                  {copiedKey === 'share_master' ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                  {copiedKey === 'share_master' ? copy.copied : fr ? 'Lien voyageur' : 'Traveler link'}
                </button>
              )}
            </div>

            <div>
              <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Notes de la date' : 'Day notes'}</div>
              {canEdit ? (
                <>
                  <textarea
                    className="in"
                    rows={4}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                  {notesDraft !== (gig.notes || '') && (
                    <button
                      type="button"
                      className="btn btn--def w-full"
                      style={{ marginTop: 6 }}
                      onClick={() => void sync.updateGigHeader(gig.id, { notes: notesDraft }).then(() => say(fr ? 'Notes enregistrées' : 'Notes saved'))}
                    >
                      {copy.save}
                    </button>
                  )}
                </>
              ) : (
                <p className="m-0 whitespace-pre-wrap">{gig.notes || '—'}</p>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="lab">{fr ? `Documents (${files.length})` : `Files (${files.length})`}</span>
                {canEdit && (
                  <label className="btn" style={{ minHeight: 28, padding: '0 8px', fontSize: 12 }}>
                    <Upload className="h-3 w-3" /> {copy.upload}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const list = Array.from(e.target.files || []);
                        e.target.value = '';
                        for (const f of list) {
                          const rec = await api.uploadFile(f, gig.id);
                          setFiles((prev) => [rec, ...prev]);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
              {files.length === 0 ? (
                <p className="sub" style={{ margin: 0 }}>{fr ? 'Aucun document joint.' : 'No files attached.'}</p>
              ) : (
                files.map((f) =>
                  onOpenFile ? (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onOpenFile(f.id)}
                      className="m2032-pcard w-full text-left"
                      style={{ color: 'inherit' }}
                    >
                      <FileText className="h-4 w-4 shrink-0 opacity-75" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="mono sub" style={{ fontSize: 11 }}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    </button>
                  ) : (
                    <a
                      key={f.id}
                      href={fileAssetUrl(f.id, true)}
                      target="_blank"
                      rel="noreferrer"
                      className="m2032-pcard"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <FileText className="h-4 w-4 shrink-0 opacity-75" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="mono sub" style={{ fontSize: 11 }}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    </a>
                  ),
                )
              )}
            </div>

            {links.length > 0 && (
              <div>
                <div className="lab" style={{ marginBottom: 6 }}>{fr ? 'Liens' : 'Links'}</div>
                {links.map((l) => (
                  <a
                    key={l.id}
                    href={String(l.data.url || '#')}
                    target="_blank"
                    rel="noreferrer"
                    className="m2032-pcard"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{String(l.data.label || l.data.url)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Thumb-Zone SmartQuickAdd Bar (Programme tab only, zero desktop clutter!) */}
      {canEdit && tab === 'schedule' && (
        <div className="m2032-quickwrap">
          <SmartQuickAdd
            gig={gig}
            items={items}
            people={people}
            onDatePersonIds={onDatePersonIds}
            placeSuggestions={placeSuggestions}
            activitySuggestions={activitySuggestions}
            locale={locale}
            inputRef={quickAddInputRef}
            onAdd={onQuickAddCommit}
            onOpenFullEditor={onOpenRowEditorParsed}
          />
        </div>
      )}

      {/* 4. Slide-Up BeOS 2032 Bottom Sheet Inspector */}
      {sheetRow && (
        <div className="m2032-sheetback" onClick={() => setSheetRowKey(null)}>
          <div className="m2032-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m2032-sheet__tab">
              <span className={`m2032-kind m2032-kind--${sheetRow.iconKind}`}>
                <KindIcon kind={sheetRow.iconKind} className="h-3.5 w-3.5" />
              </span>
              <strong className="truncate flex-1">{sheetRow.what}</strong>
              {sheetRow.time && sheetRow.time !== '—' && (
                <span className="mono m2032-setpill">{sheetRow.time}</span>
              )}
              <button type="button" className="m2032-qicon" onClick={() => setSheetRowKey(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 1-Thumb Action Strip */}
            <div className="m2032-sheet__acts">
              {sheetRow.refCode && (
                <button type="button" className="btn btn--def" onClick={() => flashCopy('sh_ref', sheetRow.refCode!)}>
                  {copiedKey === 'sh_ref' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === 'sh_ref' ? copy.copied : sheetRow.refCode}
                </button>
              )}
              {sheetRow.phone && (
                <>
                  <a className="btn btn--def" href={`tel:${sheetRow.phone.replace(/[^\d+]/g, '')}`}>
                    <Phone className="h-3.5 w-3.5" /> {fr ? 'Appeler' : 'Call'}
                  </a>
                  <a
                    className="btn"
                    href={`https://wa.me/${sheetRow.phone.replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                </>
              )}
              {(sheetRow.mapsQuery || sheetRow.where) && (
                <a
                  className="btn"
                  href={mapsHref(sheetRow.mapsQuery || sheetRow.where, gig.city)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-3.5 w-3.5" /> Maps
                </a>
              )}
              {canEdit && sheetRow.item && (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const it = sheetRow.item!;
                      setSheetRowKey(null);
                      onOpenRowEditorEdit(it);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> {fr ? 'Modifier' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const it = sheetRow.item!;
                      setSheetRowKey(null);
                      void onDuplicateItem(it);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" /> {fr ? 'Dupliquer' : 'Duplicate'}
                  </button>
                  <button
                    type="button"
                    className="btn warn"
                    onClick={() => {
                      const it = sheetRow.item!;
                      const lbl = sheetRow.what;
                      setSheetRowKey(null);
                      void onRemoveItem(it, lbl);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>

            {/* Structured Telemetry Facts */}
            <div className="m2032-sheet__facts">
              {sheetRow.facts.filter(([, v]) => v && v !== '—').map(([k, v]) => (
                <div key={k} className="m2032-fact">
                  <span className="lab">{k}</span>
                  <span className="m2032-fact__val">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
