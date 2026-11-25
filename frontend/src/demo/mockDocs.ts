/**
 * High-detail procedural SVG mock documents (Boarding Passes, Biometric Passports,
 * Entertainment Work Visas, Stage Plots & Security Advance Sheets) for /demo.
 * Clearly labeled SPECIMEN / DEMO so zero real PII or official docs exist.
 */

function toSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function aztecBlocks(seed: number, x0: number, y0: number, cell = 4): string {
  const out: string[] = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const ring = r >= 5 && r <= 9 && c >= 5 && c <= 9;
      const hash = ((seed * 131 + r * 37 + c * 17 + r * c * 7) % 11) > 4;
      if (ring ? (r === 5 || r === 9 || c === 5 || c === 9 || (r === 7 && c === 7)) : hash) {
        out.push(`<rect x="${x0 + c * cell}" y="${y0 + r * cell}" width="${cell}" height="${cell}" fill="#111827" />`);
      }
    }
  }
  return out.join('');
}

export function makeBoardingPassSvg(opts: {
  carrier: string;
  flightNo: string;
  passenger: string;
  fromIata: string;
  fromCity: string;
  toIata: string;
  toCity: string;
  date: string;
  depTime: string;
  boardTime: string;
  gate: string;
  seat: string;
  zone: string;
  pnr: string;
  cabin?: string;
  accent?: string;
  seed?: number;
}): string {
  const accent = opts.accent || '#1d4ed8';
  const blocks = aztecBlocks(opts.seed || 42, 578, 128, 6);
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="320" viewBox="0 0 760 320">
  <rect width="760" height="320" rx="12" fill="#f8fafc" />
  <rect x="0" y="0" width="760" height="58" rx="12" fill="${esc(accent)}" />
  <rect x="0" y="42" width="760" height="16" fill="${esc(accent)}" />
  <line x1="535" y1="0" x2="535" y2="320" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 6" />
  <text x="28" y="36" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700">${esc(opts.carrier)}</text>
  <text x="556" y="34" fill="#ffffff" font-family="Menlo, monospace" font-size="13" font-weight="700">BOARDING PASS · ${esc(opts.cabin || 'BUSINESS')}</text>
  <text x="28" y="88" fill="#64748b" font-family="Menlo, monospace" font-size="10">PASSENGER / NAME</text>
  <text x="28" y="108" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700">${esc(opts.passenger.toUpperCase())}</text>
  <text x="355" y="88" fill="#64748b" font-family="Menlo, monospace" font-size="10">PNR / BOOKING REF</text>
  <text x="355" y="108" fill="#0f172a" font-family="Menlo, monospace" font-size="17" font-weight="700">${esc(opts.pnr)}</text>

  <text x="28" y="170" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="800">${esc(opts.fromIata)}</text>
  <text x="28" y="192" fill="#475569" font-family="Helvetica, Arial, sans-serif" font-size="12">${esc(opts.fromCity)}</text>
  <text x="165" y="162" fill="${esc(accent)}" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700">→</text>
  <text x="220" y="170" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="800">${esc(opts.toIata)}</text>
  <text x="220" y="192" fill="#475569" font-family="Helvetica, Arial, sans-serif" font-size="12">${esc(opts.toCity)}</text>

  <rect x="28" y="216" width="480" height="72" rx="6" fill="#e2e8f0" />
  <text x="44" y="238" fill="#475569" font-family="Menlo, monospace" font-size="10">FLIGHT</text>
  <text x="44" y="264" fill="#0f172a" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.flightNo)}</text>
  <text x="148" y="238" fill="#475569" font-family="Menlo, monospace" font-size="10">DATE</text>
  <text x="148" y="264" fill="#0f172a" font-family="Menlo, monospace" font-size="16" font-weight="700">${esc(opts.date)}</text>
  <text x="268" y="238" fill="#475569" font-family="Menlo, monospace" font-size="10">BOARDING</text>
  <text x="268" y="264" fill="#b91c1c" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.boardTime)}</text>
  <text x="366" y="238" fill="#475569" font-family="Menlo, monospace" font-size="10">GATE</text>
  <text x="366" y="264" fill="#0f172a" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.gate)}</text>
  <text x="438" y="238" fill="#475569" font-family="Menlo, monospace" font-size="10">SEAT</text>
  <text x="438" y="264" fill="#0f172a" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.seat)}</text>

  <text x="556" y="88" fill="#64748b" font-family="Menlo, monospace" font-size="10">DEP ${esc(opts.depTime)} · ZONE ${esc(opts.zone)}</text>
  <text x="556" y="106" fill="#0f172a" font-family="Menlo, monospace" font-size="13" font-weight="700">${esc(opts.fromIata)} → ${esc(opts.toIata)} · ${esc(opts.seat)}</text>
  <rect x="570" y="120" width="106" height="106" rx="4" fill="#ffffff" stroke="#cbd5e1" />
  ${blocks}
  <text x="556" y="256" fill="#94a3b8" font-family="Menlo, monospace" font-size="10">DEMO SPECIMEN PASS</text>
  <text x="556" y="274" fill="#64748b" font-family="Menlo, monospace" font-size="10">ETKT 125-9901847261</text>
</svg>`);
}

export function makePassportSvg(opts: {
  country: string;
  code: string;
  surname: string;
  given: string;
  nationality: string;
  dob: string;
  passportNo: string;
  issued: string;
  expires: string;
  coverColor?: string;
}): string {
  const color = opts.coverColor || '#1e293b';
  const mrz1 = `P<${opts.code}${opts.surname.toUpperCase()}<<${opts.given.toUpperCase().replace(/\s+/g, '<')}`.padEnd(44, '<').slice(0, 44);
  const expCompact = opts.expires.replace(/-/g, '').slice(2, 8);
  const dobCompact = opts.dob.replace(/-/g, '').slice(2, 8);
  const mrz2 = `${opts.passportNo}8${opts.code}${dobCompact}4M${expCompact}6<<<<<<<<<<<<<<<02`.slice(0, 44);
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="680" height="440" viewBox="0 0 680 440">
  <rect width="680" height="440" rx="14" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2" />
  <rect x="0" y="0" width="680" height="52" rx="14" fill="${esc(color)}" />
  <rect x="0" y="38" width="680" height="14" fill="${esc(color)}" />
  <text x="24" y="33" fill="#fde68a" font-family="Menlo, monospace" font-size="16" font-weight="700">PASSPORT · ${esc(opts.country.toUpperCase())}</text>
  <text x="520" y="33" fill="#e2e8f0" font-family="Menlo, monospace" font-size="13">${esc(opts.code)} · DEMO SPECIMEN</text>

  <rect x="26" y="76" width="150" height="195" rx="6" fill="#cbd5e1" stroke="#64748b" />
  <circle cx="101" cy="146" r="34" fill="#64748b" />
  <path d="M51 245 C51 200, 151 200, 151 245 Z" fill="#64748b" />
  <text x="101" y="264" text-anchor="middle" fill="#334155" font-family="Menlo, monospace" font-size="10">PHOTO SPECIMEN</text>

  <text x="202" y="92" fill="#64748b" font-family="Menlo, monospace" font-size="10">SURNAME / NOM</text>
  <text x="202" y="112" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700">${esc(opts.surname.toUpperCase())}</text>
  <text x="440" y="92" fill="#64748b" font-family="Menlo, monospace" font-size="10">PASSPORT NO.</text>
  <text x="440" y="112" fill="#0f172a" font-family="Menlo, monospace" font-size="17" font-weight="700">${esc(opts.passportNo)}</text>

  <text x="202" y="144" fill="#64748b" font-family="Menlo, monospace" font-size="10">GIVEN NAMES / PRÉNOMS</text>
  <text x="202" y="164" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700">${esc(opts.given.toUpperCase())}</text>

  <text x="202" y="196" fill="#64748b" font-family="Menlo, monospace" font-size="10">NATIONALITY</text>
  <text x="202" y="216" fill="#0f172a" font-family="Menlo, monospace" font-size="14" font-weight="700">${esc(opts.nationality)}</text>
  <text x="440" y="196" fill="#64748b" font-family="Menlo, monospace" font-size="10">DATE OF BIRTH</text>
  <text x="440" y="216" fill="#0f172a" font-family="Menlo, monospace" font-size="14" font-weight="700">${esc(opts.dob)}</text>

  <text x="202" y="248" fill="#64748b" font-family="Menlo, monospace" font-size="10">DATE OF ISSUE</text>
  <text x="202" y="268" fill="#0f172a" font-family="Menlo, monospace" font-size="14" font-weight="700">${esc(opts.issued)}</text>
  <text x="440" y="248" fill="#b91c1c" font-family="Menlo, monospace" font-size="10">DATE OF EXPIRY</text>
  <text x="440" y="268" fill="#b91c1c" font-family="Menlo, monospace" font-size="15" font-weight="800">${esc(opts.expires)}</text>

  <rect x="20" y="318" width="640" height="96" rx="6" fill="#ffffff" stroke="#cbd5e1" />
  <text x="36" y="356" fill="#0f172a" font-family="Menlo, monospace" font-size="18" letter-spacing="1.8">${esc(mrz1)}</text>
  <text x="36" y="388" fill="#0f172a" font-family="Menlo, monospace" font-size="18" letter-spacing="1.8">${esc(mrz2)}</text>
</svg>`);
}

export function makeVisaSvg(opts: {
  title: string;
  country: string;
  visaClass: string;
  holder: string;
  petitionNo: string;
  validFrom: string;
  expires: string;
  employer: string;
  accent?: string;
}): string {
  const accent = opts.accent || '#7c2d12';
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="660" height="420" viewBox="0 0 660 420">
  <rect width="660" height="420" rx="10" fill="#fffbeb" stroke="${esc(accent)}" stroke-width="3" />
  <rect x="0" y="0" width="660" height="58" rx="8" fill="${esc(accent)}" />
  <text x="24" y="36" fill="#fef3c7" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.title.toUpperCase())}</text>
  <text x="510" y="35" fill="#fde68a" font-family="Menlo, monospace" font-size="13" font-weight="700">CLASS ${esc(opts.visaClass)}</text>

  <text x="28" y="96" fill="#78350f" font-family="Menlo, monospace" font-size="11">ISSUING NATION / AUTHORITY</text>
  <text x="28" y="118" fill="#1c1917" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700">${esc(opts.country)}</text>
  <text x="390" y="96" fill="#78350f" font-family="Menlo, monospace" font-size="11">PETITION / CONTROL NO.</text>
  <text x="390" y="118" fill="#1c1917" font-family="Menlo, monospace" font-size="17" font-weight="700">${esc(opts.petitionNo)}</text>

  <text x="28" y="160" fill="#78350f" font-family="Menlo, monospace" font-size="11">BEARER / ARTIST NAME</text>
  <text x="28" y="184" fill="#1c1917" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="800">${esc(opts.holder.toUpperCase())}</text>

  <text x="28" y="228" fill="#78350f" font-family="Menlo, monospace" font-size="11">SPONSOR / MANAGEMENT PETITIONER</text>
  <text x="28" y="250" fill="#1c1917" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="600">${esc(opts.employer)}</text>

  <rect x="28" y="280" width="604" height="72" rx="6" fill="#fef3c7" stroke="#f59e0b" />
  <text x="48" y="306" fill="#78350f" font-family="Menlo, monospace" font-size="11">VALID FROM</text>
  <text x="48" y="332" fill="#1c1917" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.validFrom)}</text>
  <text x="260" y="306" fill="#991b1b" font-family="Menlo, monospace" font-size="11">EXPIRES</text>
  <text x="260" y="332" fill="#991b1b" font-family="Menlo, monospace" font-size="18" font-weight="800">${esc(opts.expires)}</text>
  <text x="460" y="306" fill="#78350f" font-family="Menlo, monospace" font-size="11">ENTRIES</text>
  <text x="460" y="332" fill="#15803d" font-family="Menlo, monospace" font-size="18" font-weight="800">MULTIPLE</text>

  <text x="28" y="392" fill="#a8a29e" font-family="Menlo, monospace" font-size="11">WATERMARK: TOUR DESIGNER DEMO SPECIMEN — FICTIONAL SAMPLE DOCUMENT</text>
</svg>`);
}

export function makeStagePlotSvg(opts: { artist: string; setupTitle: string; notes: string[] }): string {
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="460" viewBox="0 0 760 460">
  <rect width="760" height="460" fill="#0f172a" />
  <rect x="16" y="16" width="728" height="428" fill="#1e293b" stroke="#475569" stroke-width="2" />
  <text x="32" y="48" fill="#facc15" font-family="Menlo, monospace" font-size="18" font-weight="700">${esc(opts.artist.toUpperCase())} · STAGE PLOT &amp; BOOTH SPEC (SPECIMEN)</text>
  <text x="32" y="70" fill="#94a3b8" font-family="Menlo, monospace" font-size="12">${esc(opts.setupTitle)}</text>

  <rect x="64" y="102" width="110" height="170" rx="6" fill="#0f172a" stroke="#38bdf8" stroke-width="2" />
  <text x="119" y="190" text-anchor="middle" fill="#38bdf8" font-family="Menlo, monospace" font-size="13" font-weight="700">L MONITOR</text>
  <text x="119" y="210" text-anchor="middle" fill="#94a3b8" font-family="Menlo, monospace" font-size="10">L-Acoustics X15 + SB18</text>

  <rect x="586" y="102" width="110" height="170" rx="6" fill="#0f172a" stroke="#38bdf8" stroke-width="2" />
  <text x="641" y="190" text-anchor="middle" fill="#38bdf8" font-family="Menlo, monospace" font-size="13" font-weight="700">R MONITOR</text>
  <text x="641" y="210" text-anchor="middle" fill="#94a3b8" font-family="Menlo, monospace" font-size="10">L-Acoustics X15 + SB18</text>

  <rect x="196" y="122" width="368" height="128" rx="6" fill="#334155" stroke="#facc15" stroke-width="2" />
  <rect x="208" y="142" width="74" height="86" rx="4" fill="#0f172a" stroke="#e2e8f0" />
  <text x="245" y="188" text-anchor="middle" fill="#f8fafc" font-family="Menlo, monospace" font-size="11" font-weight="700">CDJ-3000</text>
  <rect x="290" y="142" width="74" height="86" rx="4" fill="#0f172a" stroke="#e2e8f0" />
  <text x="327" y="188" text-anchor="middle" fill="#f8fafc" font-family="Menlo, monospace" font-size="11" font-weight="700">CDJ-3000</text>
  <rect x="372" y="142" width="78" height="86" rx="4" fill="#0f172a" stroke="#facc15" stroke-width="2" />
  <text x="411" y="188" text-anchor="middle" fill="#facc15" font-family="Menlo, monospace" font-size="11" font-weight="700">DJM-A9</text>
  <rect x="458" y="142" width="46" height="86" rx="4" fill="#0f172a" stroke="#e2e8f0" />
  <text x="481" y="188" text-anchor="middle" fill="#f8fafc" font-family="Menlo, monospace" font-size="10" font-weight="700">CDJ-3</text>
  <rect x="510" y="142" width="46" height="86" rx="4" fill="#0f172a" stroke="#e2e8f0" />
  <text x="533" y="188" text-anchor="middle" fill="#f8fafc" font-family="Menlo, monospace" font-size="10" font-weight="700">CDJ-4</text>

  <text x="380" y="274" text-anchor="middle" fill="#cbd5e1" font-family="Menlo, monospace" font-size="11">CONCRETE / SOLID BOOTH RISER · HEIGHT 100cm · PRO DJ LINK GIGABIT SWITCH + SHOWKONTROL TIMECODE TO FOH</text>
  <rect x="32" y="304" width="696" height="118" rx="6" fill="#0f172a" stroke="#475569" />
  ${opts.notes.slice(0, 4).map((n, i) => `<text x="48" y="${332 + i * 22}" fill="#e2e8f0" font-family="Menlo, monospace" font-size="12">· ${esc(n)}</text>`).join('')}
</svg>`);
}

export function makeHotelVoucherSvg(opts: {
  hotel: string;
  city: string;
  address: string;
  confirmation: string;
  guests: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  phone: string;
  perks: string;
  seed?: number;
}): string {
  const blocks = aztecBlocks(opts.seed || 73, 594, 150, 5.5);
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="390" viewBox="0 0 760 390">
  <rect width="760" height="390" rx="12" fill="#fffdf8" stroke="#d6d3cd" stroke-width="2" />
  <rect x="0" y="0" width="760" height="62" rx="12" fill="#78350f" />
  <rect x="0" y="44" width="760" height="18" fill="#78350f" />
  <text x="28" y="38" fill="#fef3c7" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="800">HOTEL PREPAID VOUCHER · ${esc(opts.city.toUpperCase())}</text>
  <text x="530" y="37" fill="#fde68a" font-family="Menlo, monospace" font-size="13" font-weight="700">CONF ${esc(opts.confirmation)}</text>

  <text x="28" y="96" fill="#78716c" font-family="Menlo, monospace" font-size="10">PROPERTY &amp; ADDRESS</text>
  <text x="28" y="120" fill="#1c1917" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="800">${esc(opts.hotel)}</text>
  <text x="28" y="142" fill="#57534e" font-family="Helvetica, Arial, sans-serif" font-size="13">${esc(opts.address)} · ${esc(opts.phone)}</text>

  <rect x="28" y="164" width="248" height="72" rx="6" fill="#fef3c7" stroke="#f59e0b" />
  <text x="42" y="186" fill="#92400e" font-family="Menlo, monospace" font-size="10">CHECK-IN</text>
  <text x="42" y="214" fill="#1c1917" font-family="Menlo, monospace" font-size="19" font-weight="800">${esc(opts.checkIn)}</text>

  <rect x="292" y="164" width="248" height="72" rx="6" fill="#fef3c7" stroke="#f59e0b" />
  <text x="306" y="186" fill="#92400e" font-family="Menlo, monospace" font-size="10">CHECK-OUT</text>
  <text x="306" y="214" fill="#1c1917" font-family="Menlo, monospace" font-size="19" font-weight="800">${esc(opts.checkOut)}</text>

  <rect x="580" y="138" width="112" height="112" rx="6" fill="#ffffff" stroke="#d6d3cd" />
  ${blocks}
  <text x="636" y="270" text-anchor="middle" fill="#78716c" font-family="Menlo, monospace" font-size="9">EXPRESS DESK QR</text>

  <text x="28" y="268" fill="#78716c" font-family="Menlo, monospace" font-size="10">REGISTERED GUESTS / PARTY</text>
  <text x="28" y="290" fill="#1c1917" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700">${esc(opts.guests)}</text>

  <text x="28" y="320" fill="#78716c" font-family="Menlo, monospace" font-size="10">ROOM ALLOCATION &amp; INCLUDED PERKS</text>
  <text x="28" y="340" fill="#1c1917" font-family="Menlo, monospace" font-size="12.5" font-weight="700">${esc(opts.roomType)} · ${esc(opts.perks)}</text>

  <text x="28" y="372" fill="#15803d" font-family="Menlo, monospace" font-size="11" font-weight="700">STATUS: MASTER BILL GUARANTEED BY PROMOTER · NO GUEST INCIDENTALS HOLD NEEDED</text>
</svg>`);
}

export function makeFestivalPassSvg(opts: {
  event: string;
  city: string;
  date: string;
  holder: string;
  access: string;
  badgeNo: string;
  accent?: string;
  seed?: number;
}): string {
  const accent = opts.accent || '#ca8a04';
  const blocks = aztecBlocks(opts.seed || 99, 250, 292, 5.2);
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="380" height="520" viewBox="0 0 380 520">
  <rect width="380" height="520" rx="18" fill="#111827" stroke="#374151" stroke-width="2" />
  <rect x="160" y="16" width="60" height="12" rx="6" fill="#030712" stroke="#4b5563" />
  <rect x="0" y="46" width="380" height="86" fill="${esc(accent)}" />
  <text x="24" y="84" fill="#111827" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="900">AAA ALL ACCESS</text>
  <text x="24" y="112" fill="#1f2937" font-family="Menlo, monospace" font-size="13" font-weight="700">${esc(opts.event.toUpperCase())}</text>

  <text x="24" y="168" fill="#9ca3af" font-family="Menlo, monospace" font-size="10">CITY &amp; SHOW DATE</text>
  <text x="24" y="190" fill="#f9fafb" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="700">${esc(opts.city)} · ${esc(opts.date)}</text>

  <text x="24" y="232" fill="#9ca3af" font-family="Menlo, monospace" font-size="10">CREDENTIAL HOLDER</text>
  <text x="24" y="256" fill="#fde047" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="800">${esc(opts.holder.toUpperCase())}</text>

  <rect x="24" y="284" width="204" height="96" rx="8" fill="#1f2937" stroke="#4b5563" />
  <text x="38" y="310" fill="#9ca3af" font-family="Menlo, monospace" font-size="10">ZONES CLEARED</text>
  <text x="38" y="334" fill="#34d399" font-family="Menlo, monospace" font-size="12.5" font-weight="700">${esc(opts.access)}</text>
  <text x="38" y="360" fill="#e5e7eb" font-family="Menlo, monospace" font-size="12">BADGE ${esc(opts.badgeNo)}</text>

  <rect x="242" y="284" width="96" height="96" rx="6" fill="#ffffff" />
  ${blocks}

  <rect x="24" y="408" width="332" height="72" rx="8" fill="#1f2937" />
  <text x="40" y="436" fill="#facc15" font-family="Menlo, monospace" font-size="12" font-weight="700">STAGE / BOOTH / GREEN ROOM / HELIPAD</text>
  <text x="40" y="458" fill="#9ca3af" font-family="Menlo, monospace" font-size="11">NON-TRANSFERABLE · PHOTO ID MATCH REQUIRED</text>
</svg>`);
}

export function makeSettlementSheetSvg(opts: {
  artist: string;
  city: string;
  venue: string;
  date: string;
  promoter: string;
  fee: string;
  deposit: string;
  balance: string;
  notes: string;
}): string {
  return toSvgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="740" height="440" viewBox="0 0 740 440">
  <rect width="740" height="440" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" />
  <rect x="0" y="0" width="740" height="58" rx="10" fill="#064e3b" />
  <rect x="0" y="42" width="740" height="16" fill="#064e3b" />
  <text x="26" y="37" fill="#ecfdf5" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="800">CONFIDENTIAL DEAL &amp; SETTLEMENT SHEET</text>
  <text x="530" y="36" fill="#a7f3d0" font-family="Menlo, monospace" font-size="12" font-weight="700">OWNER VAULT ONLY</text>

  <text x="26" y="92" fill="#64748b" font-family="Menlo, monospace" font-size="10">ENGAGEMENT</text>
  <text x="26" y="114" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="800">${esc(opts.artist)} @ ${esc(opts.venue)}</text>
  <text x="26" y="134" fill="#475569" font-family="Menlo, monospace" font-size="12">${esc(opts.city)} · ${esc(opts.date)} · Promoter: ${esc(opts.promoter)}</text>

  <rect x="26" y="160" width="214" height="84" rx="6" fill="#ffffff" stroke="#cbd5e1" />
  <text x="42" y="186" fill="#64748b" font-family="Menlo, monospace" font-size="10">GROSS GUARANTEE / DEAL</text>
  <text x="42" y="218" fill="#0f172a" font-family="Menlo, monospace" font-size="22" font-weight="800">${esc(opts.fee)}</text>

  <rect x="256" y="160" width="214" height="84" rx="6" fill="#ecfdf5" stroke="#10b981" />
  <text x="272" y="186" fill="#047857" font-family="Menlo, monospace" font-size="10">50% DEPOSIT RECEIVED</text>
  <text x="272" y="218" fill="#065f46" font-family="Menlo, monospace" font-size="22" font-weight="800">${esc(opts.deposit)}</text>

  <rect x="486" y="160" width="228" height="84" rx="6" fill="#fefce8" stroke="#eab308" />
  <text x="502" y="186" fill="#854d0e" font-family="Menlo, monospace" font-size="10">BALANCE DUE SHOW NIGHT</text>
  <text x="502" y="218" fill="#713f12" font-family="Menlo, monospace" font-size="22" font-weight="800">${esc(opts.balance)}</text>

  <rect x="26" y="268" width="688" height="106" rx="6" fill="#ffffff" stroke="#e2e8f0" />
  <text x="42" y="294" fill="#64748b" font-family="Menlo, monospace" font-size="10">ADVANCE TERMS &amp; WIRE / CASH PROTOCOL</text>
  <text x="42" y="322" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="600">${esc(opts.notes)}</text>
  <text x="42" y="348" fill="#64748b" font-family="Menlo, monospace" font-size="11">EXCLUDED FROM PROMOTER / DRIVER / CREW /LINK/ EXPORTS AUTOMATICALLY</text>

  <text x="26" y="408" fill="#94a3b8" font-family="Menlo, monospace" font-size="10">TOUR DESIGNER DEMO SPECIMEN — FICTIONAL CONTRACT NUMBERS FOR SANDBOX PREVIEW</text>
</svg>`);
}
