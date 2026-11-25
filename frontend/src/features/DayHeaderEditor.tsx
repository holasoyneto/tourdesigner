import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { parseSingleClock, STATUS_LABELS } from '../lib/smartParse';
import type { Gig, GigStatus, Locale, Project, User } from '../types';

interface Props {
  gig: Gig;
  projects?: Project[];
  user: User;
  locale: Locale;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}

export function DayHeaderEditor({ gig, projects = [], user, locale, onClose, onSave }: Props) {
  const fr = locale === 'fr';
  const isOwner = user.role === 'owner';

  const [artistId, setArtistId] = useState(gig.artist_id || '');
  const [name, setName] = useState(gig.name || '');
  const [date, setDate] = useState(gig.date || '');
  const [status, setStatus] = useState<GigStatus>(gig.status);
  const [city, setCity] = useState(gig.city || '');
  const [country, setCountry] = useState(gig.country || '');
  const [timezone, setTimezone] = useState(gig.timezone || '');
  const [citySug, setCitySug] = useState<Array<{ city: string; country: string; timezone: string }>>([]);

  const [venue, setVenue] = useState(gig.venue || '');
  const [venueAddress, setVenueAddress] = useState(gig.venue_address || '');
  const [venueCapacity, setVenueCapacity] = useState(gig.venue_capacity || '');
  const [doors, setDoors] = useState(gig.doors_time || '');
  const [soundcheck, setSoundcheck] = useState(gig.soundcheck_time || '');
  const [setStart, setSetStart] = useState(gig.set_time || '');
  const [setEnd, setSetEnd] = useState(gig.set_end || '');
  const [promoter, setPromoter] = useState(gig.promoter || '');
  const [ticketUrl, setTicketUrl] = useState(gig.ticket_url || '');
  const [fee, setFee] = useState(gig.fee != null ? String(gig.fee) : '');
  const [currency, setCurrency] = useState(gig.currency || 'EUR');
  const [dealType, setDealType] = useState(gig.deal_type || '');
  const [notes, setNotes] = useState(gig.notes || '');
  const [saving, setSaving] = useState(false);

  async function onCityType(val: string) {
    setCity(val);
    if (val.trim().length >= 2) {
      const r = await api.searchCities(val).catch(() => ({ cities: [] }));
      setCitySug(r.cities.slice(0, 6));
    } else setCitySug([]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        artist_id: artistId || null,
        name: name.trim() || city.trim() || date,
        date,
        status,
        city: city.trim(),
        country: country.trim(),
        timezone: timezone.trim() || null,
        venue: venue.trim(),
        venue_address: venueAddress.trim() || null,
        venue_capacity: venueCapacity.trim() || null,
        doors_time: doors.trim() ? parseSingleClock(doors) || doors.trim() : null,
        soundcheck_time: soundcheck.trim() ? parseSingleClock(soundcheck) || soundcheck.trim() : null,
        set_time: setStart.trim() ? parseSingleClock(setStart) || setStart.trim() : '',
        set_end: setEnd.trim() ? parseSingleClock(setEnd) || setEnd.trim() : null,
        promoter: promoter.trim() || null,
        ticket_url: ticketUrl.trim() || null,
        notes,
      };
      if (isOwner) {
        patch.fee = fee.trim() ? Number(fee) : null;
        patch.currency = currency.trim().toUpperCase() || 'EUR';
        patch.deal_type = dealType.trim() || null;
      }
      await onSave(patch);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="ytab" style={{ margin: '0 0 -1px 0' }}>
          <button type="button" className="box" onClick={onClose} />
          <span>{fr ? 'Informations de la date · Événement & Lieu' : 'Date Information · Event & Venue'}</span>
        </div>

        <form onSubmit={submit} className="win" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.length > 0 && (
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Projet / Artiste' : 'Project / Artist'}</span>
                <select className="in" value={artistId} onChange={(e) => setArtistId(e.target.value)}>
                  {(!user.artist_ids || user.artist_ids.length === 0) && (
                    <option value="">{fr ? '— Aucun projet assigné —' : '— Unassigned —'}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 130px 150px', gap: 8 }}>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Nom de l’événement' : 'Event name'}</span>
                <input className="in" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <label className="block space-y-1">
                <span className="lab">Date</span>
                <input type="date" className="in mono" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Statut' : 'Status'}</span>
                <select className="in" value={status} onChange={(e) => setStatus(e.target.value as GigStatus)}>
                  {(['hold', 'pending', 'confirmed', 'announced', 'advancing', 'show_day', 'played', 'cancelled'] as GigStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[locale][s]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Ville (autocomplétion)' : 'City (autocomplete)'}</span>
                  <input className="in" value={city} onChange={(e) => void onCityType(e.target.value)} />
                </label>
                {citySug.length > 0 && (
                  <div className="win" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20, background: 'var(--cv-paper)' }}>
                    {citySug.map((s) => (
                      <button
                        key={`${s.city}-${s.country}`}
                        type="button"
                        className="day"
                        style={{ gridTemplateColumns: '1fr auto' }}
                        onClick={() => {
                          setCity(s.city);
                          setCountry(s.country);
                          setTimezone(s.timezone);
                          setCitySug([]);
                        }}
                      >
                        <span>{s.city}, {s.country}</span>
                        <span className="mono sub">{s.timezone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Pays' : 'Country'}</span>
                <input className="in" value={country} onChange={(e) => setCountry(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Fuseau horaire' : 'Timezone'}</span>
                <input className="in mono" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Paris" />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.6fr 90px', gap: 8 }}>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Salle / Club / Festival' : 'Venue'}</span>
                <input className="in" value={venue} onChange={(e) => setVenue(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Adresse' : 'Venue address'}</span>
                <input className="in" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Jauge' : 'Cap.'}</span>
                <input className="in mono" value={venueCapacity} onChange={(e) => setVenueCapacity(e.target.value)} placeholder="1200" />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <label className="block space-y-1">
                <span className="lab">Soundcheck</span>
                <input className="in mono" value={soundcheck} onChange={(e) => setSoundcheck(e.target.value)} placeholder="18:30" />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Ouverture portes' : 'Doors'}</span>
                <input className="in mono" value={doors} onChange={(e) => setDoors(e.target.value)} placeholder="23:30" />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Début Set' : 'Set start'}</span>
                <input className="in mono" value={setStart} onChange={(e) => setSetStart(e.target.value)} placeholder="02:00" />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Fin Set' : 'Set end'}</span>
                <input className="in mono" value={setEnd} onChange={(e) => setSetEnd(e.target.value)} placeholder="04:00" />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Promoteur / Booking' : 'Promoter'}</span>
                <input className="in" value={promoter} onChange={(e) => setPromoter(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Billetterie (URL)' : 'Ticket URL'}</span>
                <input className="in" value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} placeholder="https://…" />
              </label>
            </div>

            {isOwner && (
              <div style={{ display: 'grid', gridTemplateColumns: '140px 90px 1fr', gap: 8, paddingTop: 6, borderTop: '1px solid var(--cv-line2)' }}>
                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Cachet (Privé)' : 'Fee (Private)'}</span>
                  <input className="in mono" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="5000" />
                </label>
                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Devise' : 'Currency'}</span>
                  <input className="in mono" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="EUR" />
                </label>
                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Deal / Conditions' : 'Deal type'}</span>
                  <input className="in" value={dealType} onChange={(e) => setDealType(e.target.value)} placeholder="50% deposit + flights + hotel" />
                </label>
              </div>
            )}

            <label className="block space-y-1">
              <span className="lab">Notes</span>
              <textarea className="in" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '8px 12px', background: 'var(--cv-chrome2)', borderTop: '1px solid var(--cv-edge)' }}>
            <button type="button" className="btn" onClick={onClose}>{fr ? 'Annuler' : 'Cancel'}</button>
            <button type="submit" className="btn btn--def" disabled={saving}>{saving ? '…' : fr ? 'Enregistrer' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
