import { registerDemoFileUrl } from '../lib/basePath';
import type { FileRecord, Gig, GigItem, Person, Project, ShareLink } from '../types';
import {
  makeBoardingPassSvg,
  makeFestivalPassSvg,
  makeHotelVoucherSvg,
  makePassportSvg,
  makeSettlementSheetSvg,
  makeStagePlotSvg,
  makeVisaSvg,
} from './mockDocs';

export interface DemoTourSnapshot {
  projects: Project[];
  gigs: Gig[];
  itemsByGig: Record<string, GigItem[]>;
  people: Person[];
  files: FileRecord[];
  shares: ShareLink[];
}

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}

const TS = '2026-11-25T18:00:00Z';

export function buildDemoTourSnapshot(): DemoTourSnapshot {
  const projects: Project[] = [
    {
      id: 'proj_hype',
      name: 'Joseph Le Hype',
      color: '#f3c64a',
      notes: 'UK House · Stereohype World Tour (2026–2027)',
      created_at: TS,
    },
    {
      id: 'proj_triesto',
      name: 'DJ Triesto',
      color: '#6ea8fe',
      notes: 'Arena, Ibiza Residency & Vegas Headline Dates',
      created_at: TS,
    },
  ];

  const people: Person[] = [
    {
      id: 'per_hype',
      name: 'Joseph Le Hype',
      person_kind: 'equipe',
      role: 'Lead Artist / DJ',
      company: 'Stereohype Touring Ltd',
      phone: '+44 7700 900112',
      email: 'joseph@stereohype-demo.example',
      notes: 'Requires 4x CDJ-3000 + DJM-A9 + dedicated booth AC fan. Prefers window seats 1A/2A.',
      loyalty: [
        { kind: 'airline', program: 'BA Executive Club (Gold)', number: 'BA-88419201' },
        { kind: 'hotel', program: 'Marriott Bonvoy (Titanium)', number: 'MB-5509128' },
      ],
      profile: {
        visa: 'US O-1B valid thru 2028-09 · Japan COE active',
        health: 'No allergies · Oat milk only',
        preferences: 'Cold coconut water, zero tequila before 02:00, black booth towels x4',
      },
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_triesto',
      name: 'DJ Triesto (Tijs V.)',
      person_kind: 'equipe',
      role: 'Headline DJ / B2B Partner',
      company: 'Musical Freedom Touring',
      phone: '+31 6 5500 8491',
      email: 'tijs@triesto-demo.example',
      notes: 'Special B2B & Vegas/Ibiza co-headline runs. Own close protection rides separately.',
      loyalty: [
        { kind: 'airline', program: 'KLM Flying Blue (Platinum)', number: 'FB-9940123' },
        { kind: 'hotel', program: 'Four Seasons Preferred', number: 'FS-119022' },
      ],
      profile: {
        visa: 'US P-1A Multi-Entry · UAE Golden Visa',
        preferences: 'Still mountain water, espresso machine in green room, quiet corner suite',
      },
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_marcus',
      name: 'Marcus Vance',
      person_kind: 'equipe',
      role: 'Tour Manager',
      company: 'Vance Road Ops',
      phone: '+44 7700 900440',
      email: 'marcus@vanceroad-demo.example',
      notes: 'Heads advancing, cash settlements & airport logistics. Passport renewal urgent!',
      loyalty: [{ kind: 'airline', program: 'OneWorld Emerald', number: 'OW-7712049' }],
      profile: {
        visa: 'ESTA approved · ATA Carnet signatory',
        health: 'Peanut allergy (carry EpiPen in TM pelicase)',
      },
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_sora',
      name: 'Sora Takahashi',
      person_kind: 'equipe',
      role: 'Visual Director / VJ',
      company: 'Kuro Pixel Tokyo',
      phone: '+81 90 5550 1823',
      email: 'sora@kuropixel-demo.example',
      notes: 'Runs Resolume Arena + ShowKontrol TCNet bridge from booth LAN switch.',
      loyalty: [{ kind: 'airline', program: 'JAL Mileage Bank', number: 'JL-4019283' }],
      profile: {
        visa: 'Japanese Citizen · US O-2 Essential Support',
      },
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_elena',
      name: 'Elena Rostova',
      person_kind: 'equipe',
      role: 'FOH & Monitor Engineer',
      company: 'SubBass Audio',
      phone: '+49 170 5550 774',
      email: 'elena@subbass-demo.example',
      notes: 'Calibrates L-Acoustics booth wedges & limiter headroom before every doors open.',
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_liam',
      name: "Liam O'Connor",
      person_kind: 'equipe',
      role: 'Lighting Designer & SFX',
      company: 'Pulse Rigging',
      phone: '+44 7700 900881',
      email: 'liam@pulserig-demo.example',
      notes: 'MA3 console + CO2/pyro timecode clearance with local fire marshal.',
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_nadia',
      name: 'Nadia Laurent',
      person_kind: 'client',
      role: 'Worldwide Booking Agent',
      company: 'Supernova Talent',
      phone: '+44 20 7946 0821',
      email: 'nadia@supernova-demo.example',
      notes: 'Final contract & radius-clause sign-off. Escalate any deposit delays 14 days out.',
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_devon',
      name: 'Devon Brooks',
      person_kind: 'equipe',
      role: 'Day-to-Day Manager',
      company: 'Stereohype Mgmt',
      phone: '+1 310 555 0144',
      email: 'devon@stereohype-demo.example',
      notes: 'Approves press/radio interviews, brand integrations & Spotify/TikTok premiere clips.',
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_maya',
      name: 'Maya Solaris',
      person_kind: 'autre',
      role: 'Support DJ / Label Act',
      company: 'Stereohype Records',
      phone: '+34 600 555 309',
      email: 'maya@solaris-demo.example',
      notes: 'Plays direct support on London, Ibiza & Berlin headline shows.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_claire',
      name: 'Claire Le Hype',
      person_kind: 'autre',
      role: 'Family / VIP All-Access',
      phone: '+44 7700 900999',
      email: 'claire.family@example.com',
      notes: 'Artist sister — permanent AAA backstage laminate on UK & EU shows.',
      permanent: true,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_lucas',
      name: 'Lucas Moretti',
      person_kind: 'equipe',
      role: 'Tour Photographer / Reels',
      company: 'Frame4AM',
      phone: '+39 340 555 0198',
      email: 'lucas@frame4am-demo.example',
      notes: 'Needs stage pit pass + 02:30 green-room recap export upload.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_bram',
      name: 'Bram De Vries',
      person_kind: 'promoteur',
      role: 'Promoter / Festival Buyer',
      company: 'Brussels Night & Boom Events',
      phone: '+32 470 55 01 92',
      email: 'bram@brussels-events-demo.example',
      notes: 'Fast settlement via SEPA. Handles Tomorrowland chopper & Fuse backline.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_mateo',
      name: 'Mateo Guzmán',
      person_kind: 'promoteur',
      role: 'Promoter LATAM',
      company: 'Zamna & CDMX Live',
      phone: '+52 55 4100 8821',
      email: 'mateo@cdmxlive-demo.example',
      notes: 'Coordinates armored Sprinter transfers in Mexico City & Tulum.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_rico',
      name: 'Rico Fernandez',
      person_kind: 'promoteur',
      role: 'Venue Director US',
      company: 'Link Miami & Vegas Nightlife',
      phone: '+1 305 555 0177',
      email: 'rico@space-demo.example',
      notes: 'Direct cell for terrace curfew extensions and artist table comps.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_kenji',
      name: 'Kenji Sato',
      person_kind: 'promoteur',
      role: 'Talent Buyer Japan',
      company: 'WOMB Shibuya Promotions',
      phone: '+81 3 5550 8812',
      email: 'kenji@womb-demo.example',
      notes: 'Handles COE visa sponsorship & bilingual sound tech in Tokyo.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_carlos',
      name: 'Carlos Mendoza',
      person_kind: 'chauffeur',
      role: 'VIP Driver (Suburban)',
      company: 'ExecMove CDMX',
      phone: '+52 55 4100 9930',
      notes: 'Speaks English & Spanish. Meets Flight AM403 at Terminal 2 Gate 4.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
    {
      id: 'per_toni',
      name: 'Big Toni',
      person_kind: 'chauffeur',
      role: 'Close Protection & V-Class',
      company: 'White Isle Security',
      phone: '+34 611 555 740',
      notes: 'Handles Ibiza airport tarmac & Marina Botafoch transfers.',
      permanent: false,
      version: 1,
      updated_at: TS,
    },
  ];

  const gigSpecs: Array<Partial<Gig> & { id: string; date: string; city: string; venue: string; country: string; artist_id: string }> = [
    {
      id: 'gig_lon_ldn',
      artist_id: 'proj_hype',
      name: 'Drumsheds MERIDIAN',
      date: '2026-11-28',
      city: 'London',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      venue: 'Drumsheds — MERIDIAN Hall',
      venue_address: '6 Glover Dr, London N18 3HF',
      venue_capacity: '15,000',
      doors_time: '14:00',
      soundcheck_time: '16:30',
      set_time: '21:30',
      set_end: '23:30',
      status: 'confirmed',
      promoter: 'Broadwick Live',
      fee: 42000,
      currency: 'GBP',
      deal_type: 'Headline Guarantee + 15% Merch',
      notes: 'BBC Radio 1 Essential Mix pre-record @ Studio B at 12:30 before site call. Sister Claire +2 AAA.',
    },
    {
      id: 'gig_sf',
      artist_id: 'proj_hype',
      name: 'Public Works SF',
      date: '2026-12-04',
      city: 'San Francisco',
      country: 'USA',
      timezone: 'America/Los_Angeles',
      venue: 'Public Works',
      venue_address: '161 Erie St, San Francisco, CA 94103',
      venue_capacity: '1,200',
      doors_time: '21:30',
      soundcheck_time: '20:00',
      set_time: '00:30',
      set_end: '02:30',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'DJ Dials / Eyeball',
      fee: 38000,
      currency: 'USD',
      deal_type: 'Guarantee vs 80% GBOR',
      notes: 'Sold-out intimate club underplay ahead of festival announce.',
    },
    {
      id: 'gig_bru',
      artist_id: 'proj_hype',
      name: 'Fuse Brussels',
      date: '2026-12-11',
      city: 'Brussels',
      country: 'Belgium',
      timezone: 'Europe/Brussels',
      venue: 'Fuse Club',
      venue_address: 'Rue Blaes 208, 1000 Bruxelles',
      venue_capacity: '1,400',
      doors_time: '23:00',
      soundcheck_time: '19:30',
      set_time: '02:00',
      set_end: '04:30',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Bram De Vries',
      fee: 24000,
      currency: 'EUR',
      deal_type: 'Flat Fee + SEPA Advance',
      notes: 'Eurostar arrival -> Studio Brussel live radio takeover 18:00.',
    },
    {
      id: 'gig_mex',
      artist_id: 'proj_hype',
      name: 'LooLoo CDMX & Festival Advance',
      date: '2026-12-18',
      city: 'Mexico City',
      country: 'Mexico',
      timezone: 'America/Mexico_City',
      venue: 'LooLoo Studio (Roma Norte)',
      venue_address: 'Londres 195, Juárez, Cuauhtémoc, 06600 CDMX',
      venue_capacity: '1,100',
      doors_time: '22:00',
      soundcheck_time: '20:30',
      set_time: '01:30',
      set_end: '03:30',
      set_day_offset: 1,
      status: 'show_day',
      promoter: 'Mateo Guzmán / CDMX Live',
      fee: 45000,
      currency: 'USD',
      deal_type: '50% Wired / 50% Door Settlement USD Cash',
      notes: 'Multi-leg LHR -> JFK -> MEX connection! Beat 100.9 FM live interview at 18:15 from Brick Hotel lobby.',
    },
    {
      id: 'gig_las_nye',
      artist_id: 'proj_triesto',
      name: 'OMNIA NYE Countdown',
      date: '2026-12-31',
      city: 'Las Vegas',
      country: 'USA',
      timezone: 'America/Los_Angeles',
      venue: 'OMNIA Nightclub — Caesars Palace',
      venue_address: '3570 S Las Vegas Blvd, Las Vegas, NV 89109',
      venue_capacity: '4,200',
      doors_time: '21:00',
      soundcheck_time: '18:00',
      set_time: '23:55',
      set_end: '02:30',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Tao Group Hospitality',
      fee: 165000,
      currency: 'USD',
      deal_type: 'NYE Residency Headline Flat',
      notes: 'Chandelier ceiling drop & midnight SMPTE countdown cue synced by Liam & Sora at 18:00.',
    },
    {
      id: 'gig_phuket',
      artist_id: 'proj_hype',
      name: 'EDC Thailand',
      date: '2027-01-16',
      city: 'Phuket',
      country: 'Thailand',
      timezone: 'Asia/Bangkok',
      venue: 'Boat Avenue Lakefront · Kinetic Field',
      venue_address: 'Choeng Thale, Thalang District, Phuket 83110',
      venue_capacity: '35,000',
      doors_time: '16:00',
      soundcheck_time: '14:30',
      set_time: '22:45',
      set_end: '00:15',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Insomniac Asia',
      fee: 55000,
      currency: 'USD',
      deal_type: 'Festival Mainstage Net + Flights',
      notes: 'Brutal Emirates transit LHR -> DXB -> HKT! Humidity protection fans mandatory on all 4 CDJ-3000 jog wheels.',
    },
    {
      id: 'gig_tulum',
      artist_id: 'proj_triesto',
      name: 'Zamna Cenote B2B',
      date: '2027-02-06',
      city: 'Tulum',
      country: 'Mexico',
      timezone: 'America/Cancun',
      venue: 'Zamna Tulum · Cenote Stage',
      venue_address: 'Carr. Federal Cancún-Tulum Km 200, 77760 Tulum',
      venue_capacity: '8,500',
      doors_time: '22:00',
      soundcheck_time: '19:00',
      set_time: '02:00',
      set_end: '06:00',
      set_day_offset: 1,
      status: 'advancing',
      promoter: 'Mateo Guzmán / Zamna',
      fee: 95000,
      currency: 'USD',
      deal_type: 'Co-Headline B2B Special',
      notes: 'Joseph Le Hype B2B DJ Triesto sunrise marathon. 2-hour armored transfer from Cancun FBO.',
    },
    {
      id: 'gig_bue',
      artist_id: 'proj_hype',
      name: 'Mandarine Park Buenos Aires',
      date: '2027-02-20',
      city: 'Buenos Aires',
      country: 'Argentina',
      timezone: 'America/Argentina/Buenos_Aires',
      venue: 'Mandarine Park & Tent',
      venue_address: 'Av. Costanera Rafael Obligado s/n, CABA',
      venue_capacity: '9,000',
      doors_time: '22:00',
      soundcheck_time: '19:30',
      set_time: '02:30',
      set_end: '05:00',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'BAN / Rio Electronic',
      fee: 40000,
      currency: 'USD',
      deal_type: 'NET USD Wired Pre-Show',
      notes: 'DJ Mag LATAM cover shoot + rooftop podcast interview at 17:00.',
    },
    {
      id: 'gig_gru',
      artist_id: 'proj_hype',
      name: 'Time Warp Brasil · ARCA',
      date: '2027-03-13',
      city: 'São Paulo',
      country: 'Brazil',
      timezone: 'America/Sao_Paulo',
      venue: 'ARCA Spaces — Cave Stage',
      venue_address: 'Av. Manuel Bandeira 360, Vila Leopoldina, SP',
      venue_capacity: '11,000',
      doors_time: '20:00',
      soundcheck_time: '18:00',
      set_time: '01:00',
      set_end: '03:00',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Cosmopop / Entourage BR',
      fee: 48000,
      currency: 'USD',
      deal_type: 'Festival Fee + Withholding Covered',
      notes: 'Customs broker pre-clearance required at GRU Terminal 3 for Sora timecode Pelicase.',
    },
    {
      id: 'gig_mia',
      artist_id: 'proj_hype',
      name: 'Ultra Bayfront + Club Space',
      date: '2027-03-27',
      city: 'Miami',
      country: 'USA',
      timezone: 'America/New_York',
      venue: 'Bayfront Park · Ultra Worldwide + Space Terrace',
      venue_address: '301 Biscayne Blvd / 34 NE 11th St, Miami FL',
      venue_capacity: '55,000',
      doors_time: '12:00',
      soundcheck_time: '17:00',
      set_time: '21:15',
      set_end: '22:30',
      status: 'confirmed',
      promoter: 'Ultra / Rico Fernandez (Space)',
      fee: 72000,
      currency: 'USD',
      deal_type: 'MMW Doubleheader Bundle',
      notes: '21:15 Ultra Worldwide Stage -> W Hotel reset -> 05:00–09:00 Club Space Terrace sunrise takeover!',
    },
    {
      id: 'gig_coachella',
      artist_id: 'proj_hype',
      name: 'Coachella · Sahara Tent (W1)',
      date: '2027-04-16',
      city: 'Indio',
      country: 'USA',
      timezone: 'America/Los_Angeles',
      venue: 'Empire Polo Club — Sahara Tent',
      venue_address: '81800 51st Ave, Indio, CA 92201',
      venue_capacity: '40,000',
      doors_time: '12:00',
      soundcheck_time: '16:30',
      set_time: '22:10',
      set_end: '23:15',
      status: 'confirmed',
      promoter: 'Goldenvoice',
      fee: 85000,
      currency: 'USD',
      deal_type: 'Goldenvoice W1+W2 Package',
      notes: 'YouTube livestream sync lock with Sora & Elena at 16:30. Private desert house in La Quinta.',
    },
    {
      id: 'gig_redrocks',
      artist_id: 'proj_triesto',
      name: 'Red Rocks Amphitheatre',
      date: '2027-05-08',
      city: 'Denver',
      country: 'USA',
      timezone: 'America/Denver',
      venue: 'Red Rocks Park & Amphitheatre',
      venue_address: '18300 W Alameda Pkwy, Morrison, CO 80465',
      venue_capacity: '9,525',
      doors_time: '18:00',
      soundcheck_time: '15:30',
      set_time: '21:00',
      set_end: '23:55',
      status: 'confirmed',
      promoter: 'AEG Presents Rocky Mountains',
      fee: 220000,
      currency: 'USD',
      deal_type: 'Headline Promoter Split 85/15',
      notes: '3-hour Sunset to Stars career retrospective. Curfew strict 00:00 ($5k/min penalty after midnight).',
    },
    {
      id: 'gig_ibiza',
      artist_id: 'proj_triesto',
      name: '[UNVRS] & Hï Ibiza Opening Week',
      date: '2027-05-29',
      city: 'Ibiza',
      country: 'Spain',
      timezone: 'Europe/Madrid',
      venue: '[UNVRS] San Rafael & Hï Ibiza Theatre',
      venue_address: 'Platja d’en Bossa / C-731 Km 6, Ibiza',
      venue_capacity: '10,000',
      doors_time: '23:30',
      soundcheck_time: '20:00',
      set_time: '02:30',
      set_end: '05:30',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'The Night League (Yann P.)',
      fee: 140000,
      currency: 'EUR',
      deal_type: 'Summer Residency Opener',
      notes: '5-night Nobu Hotel Talamanca stay. Acoustic boat showcase & Mixmag Ibiza photoshoot Friday 15:00.',
    },
    {
      id: 'gig_mad',
      artist_id: 'proj_hype',
      name: 'Fabrik CODE Madrid',
      date: '2027-06-19',
      city: 'Madrid',
      country: 'Spain',
      timezone: 'Europe/Madrid',
      venue: 'Fabrik — Main Room & Hangar',
      venue_address: 'Av. de la Industria 82, 28970 Humanes de Madrid',
      venue_capacity: '5,000',
      doors_time: '22:00',
      soundcheck_time: '19:00',
      set_time: '02:30',
      set_end: '04:30',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Nuke / CODE',
      fee: 32000,
      currency: 'EUR',
      deal_type: 'Club Headline Guarantee',
      notes: 'Short hopper IBZ -> MAD. Mixmag ES interview in green room at 23:30.',
    },
    {
      id: 'gig_tml_w1',
      artist_id: 'proj_triesto',
      name: 'Tomorrowland W1 (Mainstage)',
      date: '2027-07-17',
      city: 'Boom',
      country: 'Belgium',
      timezone: 'Europe/Brussels',
      venue: 'De Schorre — Mainstage & Artist Village',
      venue_address: 'PRC De Schorre, Schommelei 1, 2850 Boom',
      venue_capacity: '65,000',
      doors_time: '12:00',
      soundcheck_time: '17:00',
      set_time: '21:50',
      set_end: '22:50',
      status: 'confirmed',
      promoter: 'WEAREONE.world / Bram De Vries',
      fee: 190000,
      currency: 'EUR',
      deal_type: 'Festival Mainstage Prime Slot',
      notes: 'Chopper transfer from Brussels Heliport -> Festival Helipad @ 18:10. Strict 14-min fireworks SMPTE lock!',
    },
    {
      id: 'gig_tml_w2',
      artist_id: 'proj_hype',
      name: 'Tomorrowland W2 (Freedom Stage)',
      date: '2027-07-24',
      city: 'Boom',
      country: 'Belgium',
      timezone: 'Europe/Brussels',
      venue: 'De Schorre — Freedom Stage Host',
      venue_address: 'Schommelei 1, 2850 Boom, Belgium',
      venue_capacity: '18,000',
      doors_time: '12:00',
      soundcheck_time: '18:00',
      set_time: '23:00',
      set_end: '00:45',
      set_day_offset: 1,
      status: 'hold',
      promoter: 'WEAREONE.world',
      fee: 55000,
      currency: 'EUR',
      deal_type: 'W2 Takeover Option',
      notes: 'Stage host hold for Stereohype Showcase — waiting final stage time confirmations from Bram.',
    },
    {
      id: 'gig_ber',
      artist_id: 'proj_hype',
      name: 'Watergate & Kraftwerk Berlin',
      date: '2027-08-14',
      city: 'Berlin',
      country: 'Germany',
      timezone: 'Europe/Berlin',
      venue: 'Kraftwerk Berlin',
      venue_address: 'Köpenicker Str. 70, 10179 Berlin',
      venue_capacity: '3,200',
      doors_time: '22:00',
      soundcheck_time: '19:30',
      set_time: '02:00',
      set_end: '05:00',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Watergate Bookings',
      fee: 28000,
      currency: 'EUR',
      deal_type: 'Special AV Show Guarantee',
      notes: 'Long-throw laser calibration with Liam & Sora at 19:30.',
    },
    {
      id: 'gig_par',
      artist_id: 'proj_hype',
      name: 'Phantom & Rex Club Paris',
      date: '2027-09-11',
      city: 'Paris',
      country: 'France',
      timezone: 'Europe/Paris',
      venue: 'Phantom (Accor Arena)',
      venue_address: '8 Bd de Bercy, 75012 Paris',
      venue_capacity: '3,400',
      doors_time: '23:00',
      soundcheck_time: '20:30',
      set_time: '01:30',
      set_end: '04:00',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Paris Techno / Culture',
      fee: 36000,
      currency: 'EUR',
      deal_type: 'Arena Club Headline',
      notes: 'Resident Advisor "Art of DJing" studio filming at 14:30 before Bercy load-in.',
    },
    {
      id: 'gig_tyo',
      artist_id: 'proj_triesto',
      name: 'WOMB Shibuya Asia Finale',
      date: '2027-10-09',
      city: 'Tokyo',
      country: 'Japan',
      timezone: 'Asia/Tokyo',
      venue: 'WOMB Tokyo (Shibuya)',
      venue_address: '2-16 Maruyamacho, Shibuya City, Tokyo 150-0044',
      venue_capacity: '1,200',
      doors_time: '23:00',
      soundcheck_time: '20:00',
      set_time: '01:00',
      set_end: '04:00',
      set_day_offset: 1,
      status: 'confirmed',
      promoter: 'Kenji Sato / WOMB',
      fee: 110000,
      currency: 'USD',
      deal_type: 'Exclusive Asia Tour Closing',
      notes: 'Japan Entertainer COE visa hardcopy mandatory at Haneda immigration! Tower Records Shibuya signing @ 17:00.',
    },
    {
      id: 'gig_past_ldn',
      artist_id: 'proj_hype',
      name: 'Brixton Academy Pop-Up (Played)',
      date: '2026-09-18',
      city: 'London',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      venue: 'O2 Academy Brixton',
      venue_address: '211 Stockwell Rd, London SW9 9SL',
      venue_capacity: '4,921',
      doors_time: '20:00',
      soundcheck_time: '17:00',
      set_time: '22:30',
      set_end: '00:30',
      set_day_offset: 1,
      status: 'played',
      promoter: 'Live Nation UK',
      fee: 39000,
      currency: 'GBP',
      deal_type: 'Sold Out Archive',
      notes: 'Completed — settled in full 2026-09-21.',
    },
  ];

  const gigs: Gig[] = gigSpecs.map((s) => ({
    id: s.id,
    artist_id: s.artist_id,
    name: s.name || s.city,
    date: s.date,
    venue: s.venue,
    city: s.city,
    country: s.country,
    timezone: s.timezone || 'UTC',
    venue_address: s.venue_address || '',
    venue_capacity: s.venue_capacity || '',
    doors_time: s.doors_time || null,
    soundcheck_time: s.soundcheck_time || null,
    set_time: s.set_time || '01:00',
    set_end: s.set_end || null,
    set_day_offset: s.set_day_offset ?? null,
    status: s.status || 'confirmed',
    ticket_url: `https://tickets.example.com/${s.id}`,
    promoter: s.promoter || '',
    fee: s.fee ?? null,
    currency: s.currency || 'USD',
    deal_type: s.deal_type || '',
    notes: s.notes || '',
    archived: false,
    deleted_at: null,
    version: 1,
    updated_at: TS,
    items_updated_at: TS,
  }));

  const itemsByGig: Record<string, GigItem[]> = {};
  let itemSeq = 1;
  const add = (
    gigId: string,
    collection: GigItem['collection'],
    data: Record<string, unknown>,
    personIds: string[] = [],
    channel: GigItem['added_channel'] = 'web',
  ) => {
    const id = `it_demo_${itemSeq++}`;
    (itemsByGig[gigId] ||= []).push({
      id,
      gig_id: gigId,
      collection,
      data,
      person_ids: personIds,
      deleted: false,
      version: 1,
      updated_at: TS,
      added_by: 'usr_demo',
      added_by_name: channel === 'mcp' ? 'Assistant (Claude MCP)' : 'Marcus Vance',
      added_channel: channel,
    });
  };

  // --- Rich detailed schedules for flagship dates ---
  // 1. Mexico City (Multi-leg flight w/ layover + interviews + tight connection + full dossier)
  add('gig_mex', 'flights', {
    flight_no: 'BA 117',
    airline: 'British Airways',
    dep_iata: 'LHR',
    arr_iata: 'JFK',
    dep_time: '08:25',
    arr_time: '11:20',
    terminal: 'T5 -> T8',
    gate: 'B44',
    pnr: 'BA99K2',
    ref: 'BA99K2',
    seat: '1A',
    seat_by_person: { per_hype: '1A', per_marcus: '2A', per_sora: '4K' },
    notes: 'Layover at JFK T8 -> Transfer to T4 for AM403 (Clear US CBP)',
  }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_mex', 'flights', {
    flight_no: 'AM 403',
    airline: 'Aeromexico',
    dep_iata: 'JFK',
    arr_iata: 'MEX',
    dep_time: '12:50',
    arr_time: '17:20',
    terminal: 'T4 -> T2',
    gate: 'B22',
    pnr: 'E0AM77',
    ref: 'E0AM77',
    seat: '1A',
    seat_by_person: { per_hype: '1A', per_marcus: '1C', per_sora: '2A' },
    notes: 'Premier Class · Pelicase #1 & #2 checked priority',
  }, ['per_hype', 'per_marcus', 'per_sora'], 'mcp');
  add('gig_mex', 'transport', {
    time: '17:45',
    end_time: '18:30',
    from: 'MEX Terminal 2 VIP Curbside',
    to: 'Brick Hotel · Orizaba 203, Roma Norte',
    driver_name: 'Carlos Mendoza',
    driver_phone: '+52 55 4100 9930',
    vehicle: 'Black Armored Suburban (Plates CDMX-882K)',
    pnr: 'EXEC-MEX-44',
    notes: 'Chilled electrolytes + local SIM ready in center console',
  }, ['per_hype', 'per_marcus', 'per_sora', 'per_carlos']);
  add('gig_mex', 'hotels', {
    name: 'Brick Hotel Mexico City',
    address: 'Orizaba 203, Roma Nte, 06700 CDMX',
    check_in: '2026-12-18',
    check_out: '2026-12-20',
    confirmation: '#BRK-992104',
    phone: '+52 55 9138 0630',
    room_type: '2x Junior Suites + 1x King',
    wifi_ssid: 'BrickVIP_5G (pass: roma2026)',
    notes: '2 nights, late checkout 16:00 Sunday + breakfast buffet included',
  }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_mex', 'schedule', { time: '18:15', end_time: '18:55', title: 'Beat 100.9 FM Live Promo Interview', location: 'Brick Hotel Library Lounge', notes: 'Wait in lobby 18:10 w/ Devon on speakerphone' }, ['per_hype', 'per_devon']);
  add('gig_mex', 'schedule', { time: '19:45', end_time: '20:15', title: 'Crew & Artist Dinner (Contramar Catering)', location: 'Private Green Room' }, ['per_hype', 'per_marcus', 'per_sora', 'per_mateo']);
  add('gig_mex', 'schedule', { time: '20:30', end_time: '21:15', title: 'Booth Soundcheck & Timecode Lock', location: 'LooLoo Main Room' }, ['per_hype', 'per_sora', 'per_elena']);
  add('gig_mex', 'schedule', { time: '21:20', end_time: '21:40', title: 'Meet & Greet (6 Festival Contest Winners)', location: 'Backstage Mezzanine' }, ['per_hype', 'per_mateo', 'per_lucas']);
  add('gig_mex', 'timetable', { start: '22:00', end: '23:45', act: 'Warmup Resident (Paulette)', stage: 'Main Room' });
  add('gig_mex', 'timetable', { start: '23:45', end: '01:30', act: 'Maya Solaris', stage: 'Main Room' }, ['per_maya']);
  add('gig_mex', 'timetable', { start: '01:30', end: '03:30', act: 'Joseph Le Hype', stage: 'Main Room', is_us: true }, ['per_hype']);
  add('gig_mex', 'timetable', { start: '03:30', end: '05:30', act: 'CDMX Closing B2B', stage: 'Main Room' });
  add('gig_mex', 'crew', { name: 'Marcus Vance', role: 'Tour Manager', phone: '+44 7700 900440', pass_type: 'AAA' }, ['per_marcus']);
  add('gig_mex', 'crew', { name: 'Sora Takahashi', role: 'VJ / Timecode', phone: '+81 90 5550 1823', pass_type: 'AAA' }, ['per_sora']);
  add('gig_mex', 'crew', { name: 'Elena Rostova', role: 'FOH & Monitor Engineer', phone: '+49 170 5550 774', pass_type: 'AAA' }, ['per_elena']);
  add('gig_mex', 'contacts', { name: 'Mateo Guzmán', role: 'Promoter LATAM', phone: '+52 55 4100 8821', email: 'mateo@cdmxlive-demo.example' }, ['per_mateo']);
  add('gig_mex', 'contacts', { name: 'Carlos Mendoza', role: 'VIP Driver (Suburban)', phone: '+52 55 4100 9930' }, ['per_carlos']);
  add('gig_mex', 'guests', { name: 'Claire Le Hype', plus: 2, pass_type: 'AAA Family', notes: 'Front balcony VIP access' }, ['per_claire']);
  add('gig_mex', 'guests', { name: 'Lucas Moretti', plus: 1, pass_type: 'Photo Pit', notes: 'No flash during first 15 min' }, ['per_lucas']);
  add('gig_mex', 'rider', { category: 'booth', text: '4x Pioneer CDJ-3000 + DJM-A9 + Gigabit Link Switch (FW v3.1)', checked: true });
  add('gig_mex', 'rider', { category: 'tech', text: 'Dedicated CAT6 RJ45 Ethernet run from booth to FOH Resolume rack', checked: true });
  add('gig_mex', 'rider', { category: 'hospitality', text: 'Cold electrolytes, oat flat whites, steamed rice + grilled chicken, zero plastic bottles', checked: false });
  add('gig_mex', 'notes_list', { title: 'Cash Settlement Protocol', body: 'Collect remaining $22,500 USD crisp $100 bills from Mateo @ 00:45 before taking decks.' });

  // 2. London Drumsheds (Radio interview + Full Prod Crew)
  add('gig_lon_ldn', 'flights', { flight_no: 'BA 309', airline: 'British Airways', dep_iata: 'CDG', arr_iata: 'LHR', dep_time: '09:15', arr_time: '09:40', terminal: 'T2A -> T5', gate: 'K14', pnr: 'LDN77A', ref: 'LDN77A', seat: '1A', seat_by_person: { per_hype: '1A', per_marcus: '2C' }, notes: 'Inbound ferry from Paris promo morning' }, ['per_hype', 'per_marcus']);
  add('gig_lon_ldn', 'schedule', { time: '12:30', end_time: '13:45', title: 'BBC Radio 1 Essential Mix Pre-Record', location: 'Maida Vale Studio B' }, ['per_hype', 'per_devon']);
  add('gig_lon_ldn', 'transport', { time: '14:00', end_time: '14:45', from: 'Maida Vale Studios', to: 'Drumsheds Meridian Gate', driver_name: 'London Chauffeur Dispatch', driver_phone: '+44 20 7946 0190', vehicle: 'Mercedes V-Class VIP', pnr: 'UKV-119' }, ['per_hype', 'per_marcus']);
  add('gig_lon_ldn', 'schedule', { time: '16:30', end_time: '17:30', title: 'Pyro & Timecode Full Rehearsal', location: 'MERIDIAN Hall' }, ['per_hype', 'per_elena', 'per_liam', 'per_sora']);
  add('gig_lon_ldn', 'timetable', { start: '19:30', end: '21:30', act: 'Maya Solaris', stage: 'MERIDIAN' }, ['per_maya']);
  add('gig_lon_ldn', 'timetable', { start: '21:30', end: '23:30', act: 'Joseph Le Hype (Extended Warehouse Set)', stage: 'MERIDIAN', is_us: true }, ['per_hype']);
  add('gig_lon_ldn', 'hotels', { name: 'The Standard London', address: '10 Argyle St, King’s Cross, London', check_in: '2026-11-28', check_out: '2026-11-29', confirmation: '#STD-44901', phone: '+44 20 3981 8888', room_type: 'King Terraced Suites x3', wifi_ssid: 'StandardGuest (no pin)', notes: 'Early 11:00 check-in confirmed' }, ['per_hype', 'per_marcus']);
  add('gig_lon_ldn', 'guests', { name: 'Claire Le Hype', plus: 3, pass_type: 'AAA Family' }, ['per_claire']);
  add('gig_lon_ldn', 'rider', { category: 'tech', text: 'Full 14-point cryo CO2 jets + confetti cannon DMX test', checked: true });

  // 3. San Francisco
  add('gig_sf', 'flights', { flight_no: 'BA 287', airline: 'British Airways', dep_iata: 'LHR', arr_iata: 'SFO', dep_time: '10:35', arr_time: '13:45', terminal: 'T5 -> T1', gate: 'C52', pnr: 'SFR88K', ref: 'SFR88K', seat: '1A', seat_by_person: { per_hype: '1A', per_marcus: '1B' }, notes: 'Global Entry fast track at SFO' }, ['per_hype', 'per_marcus']);
  add('gig_sf', 'hotels', { name: 'San Francisco Proper Hotel', address: '1100 Market St, San Francisco', check_in: '2026-12-03', check_out: '2026-12-05', confirmation: '#PRP-30291', phone: '+1 415 735 7777', room_type: '2x Premier Corner King', wifi_ssid: 'ProperVIP (code: sf26)' }, ['per_hype', 'per_marcus']);
  add('gig_sf', 'schedule', { time: '20:00', end_time: '20:45', title: 'Main Room Soundcheck', location: 'Public Works' }, ['per_hype', 'per_elena']);
  add('gig_sf', 'timetable', { start: '00:30', end: '02:30', act: 'Joseph Le Hype', stage: 'Main Room', is_us: true }, ['per_hype']);

  // 4. Brussels Fuse
  add('gig_bru', 'transport', { time: '14:04', end_time: '16:05', from: 'London St Pancras (Eurostar 9142)', to: 'Bruxelles-Midi', mode: 'train', vehicle: 'Eurostar Premier Coach 18 · Seats 11–14', driver_name: 'Eurostar Dispatch', driver_phone: '+32 2 528 28 28', pnr: 'EST-9142B', notes: 'Passport check 45 min prior' }, ['per_hype', 'per_marcus', 'per_claire']);
  add('gig_bru', 'schedule', { time: '18:00', end_time: '18:45', title: 'Studio Brussel Guest Mix & Interview', location: 'VRT / Fuse Pop-up' }, ['per_hype']);
  add('gig_bru', 'hotels', { name: 'Hotel Amigo (Rocco Forte)', address: 'Rue de l’Amigo 1-3, Brussels', check_in: '2026-12-11', check_out: '2026-12-12', confirmation: '#AMG-7721', phone: '+32 2 547 47 47', room_type: 'Classic King & Executive Junior Suite' }, ['per_hype', 'per_marcus']);
  add('gig_bru', 'timetable', { start: '02:00', end: '04:30', act: 'Joseph Le Hype', stage: 'Room 01', is_us: true }, ['per_hype']);

  // 5. Las Vegas NYE (DJ Triesto)
  add('gig_las_nye', 'flights', { flight_no: 'JSX 244', airline: 'JSX Charter', dep_iata: 'BUR', arr_iata: 'LAS', dep_time: '14:15', arr_time: '15:25', terminal: 'Hangar 2 -> Private', gate: 'JSX', pnr: 'NYE27V', ref: 'NYE27V', seat: '1A', seat_by_person: { per_triesto: '1A', per_marcus: '2A', per_liam: '2C' }, notes: 'Private FBO security, walk straight to Sprinter' }, ['per_triesto', 'per_marcus', 'per_liam']);
  add('gig_las_nye', 'hotels', { name: 'Caesars Palace — Octavius Sky Villa', address: '3570 S Las Vegas Blvd, Las Vegas', check_in: '2026-12-30', check_out: '2027-01-02', confirmation: '#OMNIA-NYE-01', phone: '+1 866 227 5938', room_type: 'Octavius Sky Villa + 3 Crew Suites' }, ['per_triesto', 'per_marcus', 'per_elena', 'per_liam']);
  add('gig_las_nye', 'schedule', { time: '18:00', end_time: '19:00', title: 'Kinetic Chandelier Drop & Pyro Countdown Sync', location: 'OMNIA Main Deck' }, ['per_triesto', 'per_liam', 'per_sora']);
  add('gig_las_nye', 'timetable', { start: '23:55', end: '02:30', act: 'DJ Triesto (NYE Countdown)', stage: 'Main Club', is_us: true }, ['per_triesto']);

  // 6. Phuket EDC Thailand (Complicated Multi-Leg Emirates Layover + 3-Night Resort)
  add('gig_phuket', 'flights', { flight_no: 'EK 002', airline: 'Emirates', dep_iata: 'LHR', arr_iata: 'DXB', dep_time: '20:40', arr_time: '07:35', terminal: 'T3 -> B', gate: 'B18', pnr: 'EK881TH', ref: 'EK881TH', seat: '2A', seat_by_person: { per_hype: '2A', per_marcus: '2F', per_sora: '6K' }, notes: 'Emirates First/Business Lounge layover 2h50 at DXB Concourse B' }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_phuket', 'flights', { flight_no: 'EK 378', airline: 'Emirates', dep_iata: 'DXB', arr_iata: 'HKT', dep_time: '10:25', arr_time: '19:45', terminal: 'B -> Intl', gate: 'C14', pnr: 'EK881TH', ref: 'EK881TH', seat: '2A', seat_by_person: { per_hype: '2A', per_marcus: '2E', per_sora: '2K' } }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_phuket', 'hotels', { name: 'Amanpuri Resort Phuket', address: 'Pansea Beach, Choeng Thale, Phuket', check_in: '2027-01-15', check_out: '2027-01-18', confirmation: '#AMN-55912', phone: '+66 76 324 333', room_type: '2x Ocean Pool Pavilions', notes: 'Rest recovery villas post-long-haul + late boat transfer' }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_phuket', 'schedule', { time: '14:30', end_time: '15:15', title: 'Heat/Humidity CDJ Cooling & Rain Cover Inspection', location: 'Kinetic Field Booth' }, ['per_elena', 'per_sora']);
  add('gig_phuket', 'timetable', { start: '22:45', end: '00:15', act: 'Joseph Le Hype', stage: 'Kinetic Field', is_us: true }, ['per_hype']);

  // 7. Tulum B2B
  add('gig_tulum', 'flights', { flight_no: 'BA 2203', airline: 'British Airways', dep_iata: 'LGW', arr_iata: 'CUN', dep_time: '11:15', arr_time: '16:50', terminal: 'South -> T4', gate: 'A19', pnr: 'ZAM77B', ref: 'ZAM77B', seat: '1A', seat_by_person: { per_hype: '1A', per_triesto: '1E', per_marcus: '2A' } }, ['per_hype', 'per_triesto', 'per_marcus']);
  add('gig_tulum', 'hotels', { name: 'Habitas Tulum · Oceanfront', address: 'Km 4.5 Boca Paila, Tulum', check_in: '2027-02-05', check_out: '2027-02-08', confirmation: '#HAB-2094', phone: '+52 984 114 0287', room_type: '3x Ocean Bungalows' }, ['per_hype', 'per_triesto', 'per_marcus']);
  add('gig_tulum', 'timetable', { start: '02:00', end: '06:00', act: 'DJ Triesto B2B Joseph Le Hype (Sunrise)', stage: 'Cenote Mainstage', is_us: true }, ['per_triesto', 'per_hype']);

  // 8–10. South America & Miami Doubleheader
  add('gig_bue', 'flights', { flight_no: 'BA 245', airline: 'British Airways', dep_iata: 'LHR', arr_iata: 'EZE', dep_time: '21:50', arr_time: '09:15', terminal: 'T5 -> A', gate: 'B36', pnr: 'ARG901', ref: 'ARG901', seat: '1A' }, ['per_hype', 'per_marcus']);
  add('gig_bue', 'hotels', { name: 'Four Seasons Buenos Aires', address: 'Posadas 1086, Recoleta', check_in: '2027-03-04', check_out: '2027-03-06', confirmation: '#FSB-6120', phone: '+54 11 4321 1200', room_type: 'Mansión Suite + 2 King' }, ['per_hype', 'per_marcus']);
  add('gig_bue', 'schedule', { time: '17:00', end_time: '18:00', title: 'DJ Mag LATAM Cover Shoot + Acoustic Check', location: 'Four Seasons Garden' }, ['per_hype', 'per_lucas']);

  add('gig_gru', 'flights', { flight_no: 'LA 8012', airline: 'LATAM Airlines', dep_iata: 'EZE', arr_iata: 'GRU', dep_time: '11:40', arr_time: '14:35', terminal: 'A -> T3', gate: 'G9', pnr: 'BRA332', ref: 'BRA332', seat: '1A' }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_gru', 'hotels', { name: 'Rosewood São Paulo', address: 'Rua Itapeva 435, Bela Vista', check_in: '2027-03-12', check_out: '2027-03-15', confirmation: '#RWD-1920', phone: '+55 11 3797 0500', room_type: 'Mata Atlântica Suite + 2 Studios' }, ['per_hype', 'per_marcus', 'per_sora']);

  add('gig_mia', 'flights', { flight_no: 'AA 906', airline: 'American Airlines', dep_iata: 'GRU', arr_iata: 'MIA', dep_time: '23:15', arr_time: '06:40', terminal: 'T3 -> N', gate: 'D29', pnr: 'UMF27M', ref: 'UMF27M', seat: '1A', seat_by_person: { per_hype: '1A', per_marcus: '1D', per_elena: '2A' } }, ['per_hype', 'per_marcus', 'per_elena']);
  add('gig_mia', 'hotels', { name: 'W South Beach · Ocean Penthouse', address: '2201 Collins Ave, Miami Beach', check_in: '2027-03-25', check_out: '2027-03-29', confirmation: '#WSB-88120', phone: '+1 305 938 3000', room_type: 'E-WOW Oceanfront Penthouse + 2 Oasis' }, ['per_hype', 'per_marcus', 'per_devon']);
  add('gig_mia', 'timetable', { start: '21:15', end: '22:30', act: 'Joseph Le Hype (Live)', stage: 'Ultra Worldwide Stage', is_us: true }, ['per_hype']);
  add('gig_mia', 'timetable', { start: '05:00', end: '09:00', act: 'Joseph Le Hype (Afterhours Marathon)', stage: 'Club Space Terrace', is_us: true }, ['per_hype', 'per_rico']);

  // 11–13. Coachella, Red Rocks & Ibiza Week
  add('gig_coachella', 'flights', { flight_no: 'AA 1842', airline: 'American Airlines', dep_iata: 'LAX', arr_iata: 'PSP', dep_time: '13:10', arr_time: '14:02', terminal: 'T4 -> Main', gate: '42B', pnr: 'COACH27', ref: 'COACH27', seat: '1A' }, ['per_hype', 'per_marcus']);
  add('gig_coachella', 'hotels', { name: 'Parker Palm Springs · Villa', address: '4200 E Palm Canyon Dr', check_in: '2027-04-15', check_out: '2027-04-18', confirmation: '#PRK-4910', phone: '+1 760 770 5000', room_type: 'Gene Autry Estate Villa' }, ['per_hype', 'per_marcus', 'per_sora']);
  add('gig_coachella', 'schedule', { time: '16:30', end_time: '17:00', title: 'Sahara Tent Live Broadcast Timecode Sync', location: 'Empire Polo Club' }, ['per_hype', 'per_sora', 'per_elena']);

  add('gig_redrocks', 'flights', { flight_no: 'UA 1190', airline: 'United Airlines', dep_iata: 'LAS', arr_iata: 'DEN', dep_time: '11:20', arr_time: '14:15', terminal: 'T3 -> Concourse B', gate: 'B32', pnr: 'RRX2027', ref: 'RRX2027', seat: '1A' }, ['per_triesto', 'per_marcus', 'per_elena']);
  add('gig_redrocks', 'hotels', { name: 'Four Seasons Denver', address: '1111 14th St, Denver, CO', check_in: '2027-05-07', check_out: '2027-05-10', confirmation: '#FSD-7741', phone: '+1 303 389 3000', room_type: 'Presidential King + 3 Mountain View' }, ['per_triesto', 'per_marcus']);

  add('gig_ibiza', 'flights', { flight_no: 'BA 3287', airline: 'BA CityFlyer', dep_iata: 'LCY', arr_iata: 'IBZ', dep_time: '10:50', arr_time: '14:25', terminal: 'LCY -> IBZ', gate: 'G4', pnr: 'IBZ2027', ref: 'IBZ2027', seat: '1A', notes: 'Private tarmac Sprinter on arrival via Toni' }, ['per_triesto', 'per_hype', 'per_marcus', 'per_claire']);
  add('gig_ibiza', 'hotels', { name: 'Nobu Hotel Ibiza Bay', address: 'Camí Ses Feixes 52, Talamanca', check_in: '2027-05-27', check_out: '2027-06-01', confirmation: '#NOBU-8812', phone: '+34 971 192 222', room_type: 'Rooftop Bay Suites x3', notes: 'Multi-night opening week anchor stay' }, ['per_triesto', 'per_hype', 'per_marcus']);
  add('gig_ibiza', 'transport', { time: '23:15', end_time: '23:45', from: 'Nobu Talamanca', to: 'Hï Ibiza / [UNVRS] VIP Entrance', driver_name: 'Big Toni', driver_phone: '+34 611 555 740', vehicle: 'Armored V-Class (Toni)', pnr: 'TONI-IBZ' }, ['per_triesto', 'per_toni']);

  // 14–19. Madrid, Tomorrowland W1/W2, Berlin, Paris, Tokyo, Past Brixton
  add('gig_mad', 'flights', { flight_no: 'IB 3805', airline: 'Iberia', dep_iata: 'IBZ', arr_iata: 'MAD', dep_time: '15:10', arr_time: '16:25', terminal: 'T1 -> T4', gate: 'H10', pnr: 'MAD449', ref: 'MAD449', seat: '1A' }, ['per_hype', 'per_marcus']);
  add('gig_mad', 'hotels', { name: 'The Madrid EDITION', address: 'Plaza de Celenque 2, Madrid', check_in: '2027-06-18', check_out: '2027-06-20', confirmation: '#EDM-3109', phone: '+34 919 54 54 20', room_type: 'Opera Penthouse + 2 Deluxe' }, ['per_hype', 'per_marcus']);

  add('gig_tml_w1', 'flights', { flight_no: 'SN 2094', airline: 'Brussels Airlines', dep_iata: 'LHR', arr_iata: 'BRU', dep_time: '13:10', arr_time: '15:25', terminal: 'T2 -> A', gate: 'A44', pnr: 'TMLW1X', ref: 'TMLW1X', seat: '1A' }, ['per_triesto', 'per_marcus', 'per_liam']);
  add('gig_tml_w1', 'hotels', { name: 'Corinthia Grand Hotel Astoria', address: 'Rue Royale 103, Brussels', check_in: '2027-07-16', check_out: '2027-07-19', confirmation: '#COR-2027W1', phone: '+32 2 220 66 11', room_type: 'Royal Suite + 3 Crew Rooms' }, ['per_triesto', 'per_marcus', 'per_sora', 'per_liam']);
  add('gig_tml_w1', 'transport', { time: '18:10', end_time: '18:30', from: 'Brussels Heliport', to: 'Tomorrowland Artist Helipad (De Schorre)', driver_name: 'HeliOps Boom #04', driver_phone: '+32 470 55 01 92', vehicle: 'Airbus H145 Charter', pnr: 'HELI-W1' }, ['per_triesto', 'per_marcus', 'per_bram']);
  add('gig_tml_w1', 'schedule', { time: '21:50', end_time: '22:50', title: 'Mainstage Headline & Fireworks SMPTE Finale', location: 'Tomorrowland Mainstage' }, ['per_triesto', 'per_liam', 'per_sora']);

  add('gig_tml_w2', 'flights', { flight_no: 'KL 1725', airline: 'KLM', dep_iata: 'AMS', arr_iata: 'BRU', dep_time: '13:30', arr_time: '14:20', terminal: 'Schiphol -> A', gate: 'C11', pnr: 'TMLW2H', ref: 'TMLW2H', seat: '1C' }, ['per_hype', 'per_marcus']);
  add('gig_tml_w2', 'hotels', { name: 'Dominican Hotel Brussels', address: 'Rue Léopold 9, Brussels', check_in: '2027-07-23', check_out: '2027-07-26', confirmation: '#DOM-8820W2', phone: '+32 2 203 08 08', room_type: 'Courtyard Loft + 2 Exec' }, ['per_hype', 'per_marcus', 'per_maya']);
  add('gig_tml_w2', 'schedule', { time: '23:00', end_time: '00:45', title: 'Stereohype Showcase Option Hold', location: 'Freedom Stage' }, ['per_hype', 'per_maya']);

  add('gig_ber', 'flights', { flight_no: 'SN 2583', airline: 'Brussels Airlines', dep_iata: 'BRU', arr_iata: 'BER', dep_time: '13:45', arr_time: '15:10', terminal: 'B -> T1', gate: 'A07', pnr: 'BER14A', ref: 'BER14A', seat: '1A' }, ['per_hype', 'per_sora']);
  add('gig_ber', 'hotels', { name: 'SO/ Berlin Das Stue', address: 'Drakestraße 1, Berlin', check_in: '2027-08-14', check_out: '2027-08-16', confirmation: '#STUE-5509', phone: '+49 30 3117220', room_type: 'Stue Penthouse + 2 Bel Air' }, ['per_hype', 'per_marcus', 'per_elena']);

  add('gig_par', 'transport', { time: '11:31', end_time: '14:48', from: 'London St Pancras (Eurostar 9024)', to: 'Paris Gare du Nord', mode: 'train', vehicle: 'Eurostar Premier Coach 18 · Seats 21–24', driver_name: 'Eurostar Premier', driver_phone: '+33 1 70 70 60 88', pnr: 'EST-PAR27' }, ['per_hype', 'per_marcus', 'per_devon']);
  add('gig_par', 'hotels', { name: 'Hôtel Rochechouart · Pigalle', address: '55 Bd Marguerite de Rochechouart, Paris', check_in: '2027-09-18', check_out: '2027-09-20', confirmation: '#RCH-7712', phone: '+33 1 42 81 91 00', room_type: 'Suite Montmartre + 2 Superior' }, ['per_hype', 'per_marcus', 'per_devon']);
  add('gig_par', 'schedule', { time: '14:30', end_time: '16:00', title: 'Resident Advisor "Art of DJing" Video Shoot', location: 'Studio Belleville' }, ['per_hype', 'per_devon']);

  add('gig_tyo', 'flights', { flight_no: 'JL 046', airline: 'Japan Airlines', dep_iata: 'CDG', arr_iata: 'HND', dep_time: '21:15', arr_time: '17:55', terminal: '2E -> T3', gate: 'K41', pnr: 'TYO9921', ref: 'TYO9921', seat: '1A', seat_by_person: { per_triesto: '1A', per_hype: '1K', per_marcus: '2A', per_sora: '5A' }, notes: '+1 day arrival HND Terminal 3 · Keep hardcopy Japan COE folder handy!' }, ['per_triesto', 'per_hype', 'per_marcus', 'per_sora']);
  add('gig_tyo', 'hotels', { name: 'TRUNK Hotel Yoyogi Park / Shibuya', address: '1-15-20 Tomigaya, Shibuya', check_in: '2027-10-08', check_out: '2027-10-12', confirmation: '#TRNK-7721', phone: '+81 3 5766 3210', room_type: 'Owner’s Suite + 3 Balcony King' }, ['per_triesto', 'per_hype', 'per_marcus']);
  add('gig_tyo', 'schedule', { time: '17:00', end_time: '18:00', title: 'Tower Records Shibuya Signing & Merch Pop-up', location: 'Shibuya 1-22-14' }, ['per_hype', 'per_kenji']);

  add('gig_past_ldn', 'flights', { flight_no: 'KL 1008', airline: 'KLM', dep_iata: 'AMS', arr_iata: 'LHR', dep_time: '11:20', arr_time: '11:45', terminal: 'T4', gate: 'D24', pnr: 'BRX991', ref: 'BRX991', seat: '1A' }, ['per_hype', 'per_marcus']);
  add('gig_past_ldn', 'hotels', { name: 'One Hundred Shoreditch', address: '100 Shoreditch High St, London', check_in: '2026-10-18', check_out: '2026-10-19', confirmation: '#OHS-1129', phone: '+44 20 7613 9800', room_type: 'Studio King + Terrace' }, ['per_hype', 'per_marcus']);
  add('gig_past_ldn', 'schedule', { time: '16:30', end_time: '17:30', title: 'Live DVD Capture Rig & Timecode Sync', location: 'Brixton Main Hall' }, ['per_hype', 'per_sora', 'per_elena', 'per_lucas']);

  // --- Ensure ALL 20 gigs have complete sections (transport, schedule, lineup, crew, contacts, guests, rider, notes) ---
  const cityAirportMap: Record<string, string> = {
    gig_lon_ldn: 'LHR VIP Jet Centre',
    gig_sf: 'SFO Intl Arrivals Terminal',
    gig_bru: 'Bruxelles-Midi VIP Lounge',
    gig_las_nye: 'LAS JSX Hangar',
    gig_phuket: 'HKT Phuket International Gate 2',
    gig_tulum: 'CUN Cancun T4 / Tulum Coastal Shuttle',
    gig_bue: 'EZE Ezeiza VIP Terminal',
    gig_gru: 'GRU Terminal 3 Diplomatic',
    gig_mia: 'MIA North Terminal Curbside',
    gig_coachella: 'PSP Palm Springs Jet Ramp',
    gig_redrocks: 'DEN East Signature Ramp',
    gig_ibiza: 'IBZ Aviation VIP Gate',
    gig_mad: 'MAD Barajas T4 Arrivals',
    gig_tml_w1: 'Corinthia Hotel Lobby',
    gig_tml_w2: 'BRU Zaventem VIP Curb',
    gig_ber: 'BER Terminal 1 VIP',
    gig_par: 'Paris Gare du Nord Hall 1',
    gig_tyo: 'HND Terminal 3 Arrival Lobby',
    gig_past_ldn: 'LHR Terminal 4',
  };

  for (let i = 0; i < gigs.length; i++) {
    const g = gigs[i];
    const cur = itemsByGig[g.id] || [];
    const has = (col: GigItem['collection']) => cur.some((it) => it.collection === col);
    const isTriesto = g.artist_id === 'proj_triesto';
    const leadId = isTriesto ? 'per_triesto' : 'per_hype';
    const leadName = isTriesto ? 'DJ Triesto' : 'Joseph Le Hype';

    if (!has('transport')) {
      add(g.id, 'transport', {
        time: '16:15',
        end_time: '16:55',
        from: cityAirportMap[g.id] || `${g.city} Hub`,
        to: g.venue || `${g.city} Hotel`,
        driver_name: g.country === 'USA' ? 'ExecFleet US Dispatch' : 'Local Artist Transport',
        driver_phone: g.country === 'USA' ? '+1 305 555 0194' : '+44 20 7946 0300',
        vehicle: 'Black Mercedes Sprinter / V-Class',
        pnr: `DRV-${g.id.slice(4, 9).toUpperCase()}`,
      }, [leadId, 'per_marcus']);
    }
    if (!cur.some((it) => it.collection === 'schedule' && /soundcheck/i.test(String(it.data.title || '')))) {
      add(g.id, 'schedule', {
        time: g.soundcheck_time || '19:30',
        end_time: '20:15',
        title: `Booth Soundcheck & ShowKontrol Sync`,
        location: g.venue,
        notes: 'Verify 4x CDJ-3000 firmware v3.1 + Pro DJ Link switch',
      }, [leadId, 'per_elena', 'per_sora']);
    }
    if (!cur.some((it) => it.collection === 'schedule' && /dinner|catering/i.test(String(it.data.title || '')))) {
      add(g.id, 'schedule', {
        time: '20:30',
        end_time: '21:15',
        title: 'Hot Artist & Crew Dinner',
        location: 'Artist Green Room',
        notes: 'Oat milk flat whites + clean protein bowls ready',
      }, [leadId, 'per_marcus']);
    }
    if (!has('timetable')) {
      add(g.id, 'timetable', { start: g.doors_time || '22:00', end: '23:45', act: 'Local Resident Warmup', stage: g.venue });
      add(g.id, 'timetable', { start: '23:45', end: g.set_time || '01:00', act: 'Maya Solaris', stage: g.venue }, ['per_maya']);
      add(g.id, 'timetable', { start: g.set_time || '01:00', end: g.set_end || '03:00', act: leadName, stage: g.venue, is_us: true }, [leadId]);
    }
    if (!has('crew')) {
      add(g.id, 'crew', { name: 'Marcus Vance', role: 'Tour Manager', phone: '+44 7700 900440', pass_type: 'AAA' }, ['per_marcus']);
      add(g.id, 'crew', { name: 'Elena Rostova', role: 'FOH & Monitor Eng', phone: '+49 170 5550 774', pass_type: 'AAA' }, ['per_elena']);
      add(g.id, 'crew', { name: 'Sora Takahashi', role: 'Visual Director', phone: '+81 90 5550 1823', pass_type: 'AAA' }, ['per_sora']);
    }
    if (!has('contacts')) {
      const promoterPerson = g.city === 'Tokyo' ? 'per_kenji' : ['Tulum', 'Buenos Aires', 'São Paulo'].includes(g.city) ? 'per_mateo' : ['Brussels', 'Boom', 'Berlin', 'Paris', 'Madrid'].includes(g.city) ? 'per_bram' : 'per_rico';
      const pObj = people.find((p) => p.id === promoterPerson);
      if (pObj) {
        add(g.id, 'contacts', { name: pObj.name, role: g.promoter || pObj.role, phone: pObj.phone, email: pObj.email }, [pObj.id]);
      }
      add(g.id, 'contacts', { name: 'Nadia Laurent', role: 'Worldwide Booking Agent', phone: '+44 20 7946 0821', email: 'nadia@supernova-demo.example' }, ['per_nadia']);
    }
    if (!has('guests')) {
      add(g.id, 'guests', { name: 'Lucas Moretti', plus: 1, pass_type: 'Photo Pit', notes: 'Booth side access all night' }, ['per_lucas']);
      add(g.id, 'guests', { name: 'Devon Brooks', plus: 2, pass_type: 'VIP Table', notes: 'Mgmt + local press guests' }, ['per_devon']);
    }
    if (!has('rider')) {
      add(g.id, 'rider', { category: 'booth', text: '4x Pioneer CDJ-3000 + DJM-A9 + Gigabit Ethernet Link + Booth Fan', checked: true });
      add(g.id, 'rider', { category: 'hospitality', text: 'Chilled coconut water, espresso bar, black towels x4, hot meal post-set', checked: true });
    }
    if (!has('notes_list')) {
      add(g.id, 'notes_list', {
        title: 'Settlement & Advance',
        body: `${g.deal_type || 'Flat Guarantee'} · ${g.currency} ${(g.fee || 0).toLocaleString()} · 50% deposit cleared prior to flight.`,
      });
    }
  }

  // --- Mock Realistic Documents with Generated Visual SVGs across ALL 20 Gigs ---
  const expSoonIso = daysFromNowIso(42);
  const rawDocs: Array<{ file: FileRecord; uri: string }> = [
    {
      file: {
        id: 'file_bp_mex',
        object_id: 'obj_demo_bp_mex',
        gig_id: 'gig_mex',
        person_id: 'per_hype',
        name: 'AM403-JFK-MEX-Boarding-Pass.svg',
        mime: 'image/svg+xml',
        size: 14280,
        doc_kind: 'boarding_pass',
        scope: 'crew',
        pinned: true,
        added_at: TS,
      },
      uri: makeBoardingPassSvg({
        carrier: 'AEROMEXICO PREMIER',
        flightNo: 'AM 403',
        passenger: 'JOSEPH LE HYPE',
        fromIata: 'JFK',
        fromCity: 'New York T4',
        toIata: 'MEX',
        toCity: 'Mexico City T2',
        date: '18 DEC 26',
        depTime: '12:50',
        boardTime: '12:05',
        gate: 'B22',
        seat: '1A',
        zone: 'PREMIER 1',
        pnr: 'E0AM77',
        accent: '#0c4a6e',
        seed: 101,
      }),
    },
    {
      file: {
        id: 'file_bp_lhr_jfk',
        object_id: 'obj_demo_bp_jfk',
        gig_id: 'gig_mex',
        person_id: 'per_hype',
        name: 'BA117-LHR-JFK-Boarding-Pass.svg',
        mime: 'image/svg+xml',
        size: 14110,
        doc_kind: 'boarding_pass',
        scope: 'crew',
        pinned: true,
        added_at: TS,
      },
      uri: makeBoardingPassSvg({
        carrier: 'BRITISH AIRWAYS CLUB',
        flightNo: 'BA 117',
        passenger: 'JOSEPH LE HYPE',
        fromIata: 'LHR',
        fromCity: 'London Heathrow T5',
        toIata: 'JFK',
        toCity: 'New York T8',
        date: '18 DEC 26',
        depTime: '08:25',
        boardTime: '07:45',
        gate: 'B44',
        seat: '1A',
        zone: 'GROUP 1',
        pnr: 'BA99K2',
        accent: '#1e3a8a',
        seed: 17,
      }),
    },
    {
      file: {
        id: 'file_bp_phuket',
        object_id: 'obj_demo_bp_hkt',
        gig_id: 'gig_phuket',
        person_id: 'per_hype',
        name: 'EK378-DXB-HKT-Boarding-Pass.svg',
        mime: 'image/svg+xml',
        size: 14500,
        doc_kind: 'boarding_pass',
        scope: 'crew',
        pinned: true,
        added_at: TS,
      },
      uri: makeBoardingPassSvg({
        carrier: 'EMIRATES BUSINESS',
        flightNo: 'EK 378',
        passenger: 'JOSEPH LE HYPE',
        fromIata: 'DXB',
        fromCity: 'Dubai Intl',
        toIata: 'HKT',
        toCity: 'Phuket Intl',
        date: '15 JAN 27',
        depTime: '10:25',
        boardTime: '09:40',
        gate: 'C14',
        seat: '2A',
        zone: 'FIRST / BIZ',
        pnr: 'EK881TH',
        accent: '#991b1b',
        seed: 88,
      }),
    },
    {
      file: {
        id: 'file_bp_tokyo',
        object_id: 'obj_demo_bp_tyo',
        gig_id: 'gig_tyo',
        person_id: 'per_triesto',
        name: 'JL046-CDG-HND-SkySuite-Pass.svg',
        mime: 'image/svg+xml',
        size: 14600,
        doc_kind: 'boarding_pass',
        scope: 'crew',
        pinned: true,
        added_at: TS,
      },
      uri: makeBoardingPassSvg({
        carrier: 'JAPAN AIRLINES SKY SUITE',
        flightNo: 'JL 046',
        passenger: 'TRIESTO TIJS V.',
        fromIata: 'CDG',
        fromCity: 'Paris CDG 2E',
        toIata: 'HND',
        toCity: 'Tokyo Haneda T3',
        date: '08 OCT 27',
        depTime: '21:15',
        boardTime: '20:35',
        gate: 'K41',
        seat: '1A',
        zone: 'DIAMOND',
        pnr: 'TYO9921',
        accent: '#b91c1c',
        seed: 205,
      }),
    },
    {
      file: {
        id: 'file_pp_hype',
        object_id: 'obj_demo_pp_hype',
        person_id: 'per_hype',
        name: 'Joseph-Le-Hype-UK-Passport.svg',
        mime: 'image/svg+xml',
        size: 18400,
        doc_kind: 'passport',
        doc_country: 'United Kingdom',
        doc_expires: '2031-08-14',
        scope: 'private',
        pinned: false,
        added_at: TS,
      },
      uri: makePassportSvg({
        country: 'United Kingdom',
        code: 'GBR',
        surname: 'Le Hype',
        given: 'Joseph Edward',
        nationality: 'BRITISH CITIZEN',
        dob: '1993-07-04',
        passportNo: '549812093',
        issued: '2021-08-14',
        expires: '2031-08-14',
        coverColor: '#1e3a8a',
      }),
    },
    {
      file: {
        id: 'file_pp_triesto',
        object_id: 'obj_demo_pp_triesto',
        person_id: 'per_triesto',
        name: 'DJ-Triesto-NL-Passport.svg',
        mime: 'image/svg+xml',
        size: 18500,
        doc_kind: 'passport',
        doc_country: 'Netherlands',
        doc_expires: '2030-05-20',
        scope: 'private',
        pinned: false,
        added_at: TS,
      },
      uri: makePassportSvg({
        country: 'Kingdom of the Netherlands',
        code: 'NLD',
        surname: 'Triesto',
        given: 'Tijs Michiel',
        nationality: 'NEDERLANDSE',
        dob: '1986-01-17',
        passportNo: 'NV9920144',
        issued: '2020-05-20',
        expires: '2030-05-20',
        coverColor: '#7f1d1d',
      }),
    },
    {
      file: {
        id: 'file_pp_marcus',
        object_id: 'obj_demo_pp_marcus',
        person_id: 'per_marcus',
        name: 'Marcus-Vance-TM-Passport-EXPIRING-SOON.svg',
        mime: 'image/svg+xml',
        size: 18200,
        doc_kind: 'passport',
        doc_country: 'United Kingdom',
        doc_expires: expSoonIso,
        scope: 'private',
        pinned: true,
        added_at: TS,
      },
      uri: makePassportSvg({
        country: 'United Kingdom',
        code: 'GBR',
        surname: 'Vance',
        given: 'Marcus Anthony',
        nationality: 'BRITISH CITIZEN',
        dob: '1988-03-22',
        passportNo: '511094820',
        issued: '2017-01-05',
        expires: expSoonIso,
        coverColor: '#312e81',
      }),
    },
    {
      file: {
        id: 'file_visa_us_o1',
        object_id: 'obj_demo_visa_us',
        gig_id: 'gig_mia',
        person_id: 'per_hype',
        name: 'US-O1B-Entertainment-Visa-Joseph-Le-Hype.svg',
        mime: 'image/svg+xml',
        size: 16200,
        doc_kind: 'visa',
        doc_country: 'United States',
        doc_expires: '2028-09-30',
        scope: 'private',
        pinned: true,
        added_at: TS,
      },
      uri: makeVisaSvg({
        title: 'United States Visa · Nonimmigrant Artist',
        country: 'United States (USCIS CSC)',
        visaClass: 'O-1B',
        holder: 'Joseph Le Hype',
        petitionNo: 'WAC-26-991-00412',
        validFrom: '2026-10-01',
        expires: '2028-09-30',
        employer: 'Supernova Talent / Stereohype Touring LLC',
        accent: '#1e40af',
      }),
    },
    {
      file: {
        id: 'file_visa_jp_coe',
        object_id: 'obj_demo_visa_jp',
        gig_id: 'gig_tyo',
        person_id: 'per_triesto',
        name: 'Japan-Entertainer-COE-Permit-Tokyo-WOMB.svg',
        mime: 'image/svg+xml',
        size: 15900,
        doc_kind: 'visa',
        doc_country: 'Japan',
        doc_expires: '2027-12-31',
        scope: 'private',
        pinned: true,
        added_at: TS,
      },
      uri: makeVisaSvg({
        title: 'Japan Certificate of Eligibility · Entertainer',
        country: 'Ministry of Justice · Tokyo Bureau',
        visaClass: 'KOUGYOU 4',
        holder: 'DJ Triesto & Joseph Le Hype Crew',
        petitionNo: 'TYO-COE-2027-44910',
        validFrom: '2027-10-01',
        expires: '2027-12-31',
        employer: 'WOMB Shibuya Promotions · Kenji Sato',
        accent: '#991b1b',
      }),
    },
    {
      file: {
        id: 'file_visa_th_edc',
        object_id: 'obj_demo_visa_th',
        gig_id: 'gig_phuket',
        person_id: 'per_hype',
        name: 'Thailand-BOI-Festival-Work-Permit-Phuket.svg',
        mime: 'image/svg+xml',
        size: 15700,
        doc_kind: 'visa',
        doc_country: 'Thailand',
        doc_expires: '2027-02-01',
        scope: 'crew',
        pinned: false,
        added_at: TS,
      },
      uri: makeVisaSvg({
        title: 'Kingdom of Thailand · Temporary Performance Permit',
        country: 'Phuket Provincial Employment Office',
        visaClass: 'NON-B PERF',
        holder: 'Joseph Le Hype + 2 Support Crew',
        petitionNo: 'HKT-EDC-2027-0881',
        validFrom: '2027-01-12',
        expires: '2027-02-01',
        employer: 'Insomniac Asia Productions Co.',
        accent: '#065f46',
      }),
    },
    {
      file: {
        id: 'file_rider_stageplot',
        object_id: 'obj_demo_stageplot',
        gig_id: 'gig_tml_w1',
        name: 'Headline-Booth-StagePlot-4xCDJ3000-A9.svg',
        mime: 'image/svg+xml',
        size: 19400,
        doc_kind: 'rider',
        scope: 'crew',
        pinned: true,
        added_at: TS,
      },
      uri: makeStagePlotSvg({
        artist: 'Joseph Le Hype × DJ Triesto',
        setupTitle: 'PRO DJ LINK GIGABIT + SHOWKONTROL TIMECODE TO FOH VISUALS & PYRO',
        notes: [
          '4x Pioneer CDJ-3000 (Firmware 3.1+) + 1x DJM-A9 + Gigabit unmanaged switch',
          'Dual L/R 3-way Booth Monitors + dual 18" subwoofers on isolated deck decouplers',
          'Direct CAT6 line from Booth to FOH Resolume & MA3 for zero-latency fireworks/SFX sync',
          'Concrete/ballasted 100cm deck height — zero bounce under foot',
        ],
      }),
    },
  ];

  // Auto-generate rich Boarding Passes, Hotel Vouchers, AAA Credentials & Private Settlements across ALL 20 gigs
  const palette = ['#1d4ed8', '#0f766e', '#7c2d12', '#4338ca', '#991b1b', '#0369a1'];
  for (let i = 0; i < gigs.length; i++) {
    const g = gigs[i];
    const items = itemsByGig[g.id] || [];
    const leadId = g.artist_id === 'proj_triesto' ? 'per_triesto' : 'per_hype';
    const leadName = g.artist_id === 'proj_triesto' ? 'DJ TRIESTO' : 'JOSEPH LE HYPE';
    const leadUpper = leadName;
    const slug = g.city.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

    // 1. Boarding Pass SVG for every gig flight that doesn't already have a handcrafted BP
    const fl = items.find((it) => it.collection === 'flights');
    if (fl && !rawDocs.some((r) => r.file.gig_id === g.id && r.file.doc_kind === 'boarding_pass')) {
      const fd = fl.data;
      const fn = String(fd.flight_no || 'BA 101').replace(/\s+/g, '');
      rawDocs.push({
        file: {
          id: `file_bp_auto_${g.id}`,
          object_id: `obj_bp_${g.id}`,
          gig_id: g.id,
          person_id: leadId,
          name: `${fn}-${String(fd.dep_iata || 'LHR')}-${String(fd.arr_iata || 'DEST')}-Pass.svg`,
          mime: 'image/svg+xml',
          size: 14120 + i * 37,
          doc_kind: 'boarding_pass',
          scope: 'crew',
          pinned: i < 4,
          added_at: TS,
        },
        uri: makeBoardingPassSvg({
          carrier: String(fd.airline || 'PRIORITY AIR'),
          flightNo: String(fd.flight_no || 'BA 101'),
          passenger: leadUpper,
          fromIata: String(fd.dep_iata || 'LHR'),
          fromCity: `${String(fd.dep_iata || 'LHR')} Intl`,
          toIata: String(fd.arr_iata || g.city.slice(0, 3).toUpperCase()),
          toCity: `${g.city} (${String(fd.arr_iata || '')})`,
          date: g.date,
          depTime: String(fd.dep_time || '10:30'),
          boardTime: String(fd.dep_time || '09:50'),
          gate: String(fd.gate || 'A12'),
          seat: String(fd.seat || '1A'),
          zone: 'GROUP 1',
          pnr: String(fd.pnr || fd.ref || 'TD2027'),
          accent: palette[i % palette.length],
          seed: 300 + i * 19,
        }),
      });
    }

    // 2. Hotel Confirmation Voucher SVG for every hotel
    const ht = items.find((it) => it.collection === 'hotels');
    if (ht) {
      const hd = ht.data;
      rawDocs.push({
        file: {
          id: `file_hotel_auto_${g.id}`,
          object_id: `obj_ht_${g.id}`,
          gig_id: g.id,
          person_id: leadId,
          name: `Hotel-Voucher-${slug}-${String(hd.confirmation || '#VIP').replace(/[^A-Za-z0-9-]/g, '')}.svg`,
          mime: 'image/svg+xml',
          size: 16840 + i * 41,
          doc_kind: 'hotel',
          scope: 'crew',
          pinned: i === 3 || i === 5,
          added_at: TS,
        },
        uri: makeHotelVoucherSvg({
          hotel: String(hd.name || `${g.city} Hotel`),
          city: g.city,
          address: String(hd.address || g.city),
          confirmation: String(hd.confirmation || `#CONF-${i + 101}`),
          guests: `${leadName} + Marcus Vance (TM) + Tech Crew`,
          roomType: String(hd.room_type || '1x Suite + 2x Executive King'),
          checkIn: String(hd.check_in || g.date),
          checkOut: String(hd.check_out || g.date),
          phone: String(hd.phone || '+1 800 555 0199'),
          perks: String(hd.notes || 'Early check-in + late 16:00 checkout + breakfast'),
          seed: 500 + i * 23,
        }),
      });
    }

    // 3. AAA Backstage Credential for festivals & headline shows (plus CDMX & Ibiza Stage Plots)
    if (i % 2 === 0 || ['gig_mex', 'gig_ibiza', 'gig_tml_w1', 'gig_tml_w2', 'gig_coachella', 'gig_mia'].includes(g.id)) {
      rawDocs.push({
        file: {
          id: `file_aaa_${g.id}`,
          object_id: `obj_aaa_${g.id}`,
          gig_id: g.id,
          person_id: leadId,
          name: `AAA-Artist-Credential-${slug}.svg`,
          mime: 'image/svg+xml',
          size: 13450 + i * 29,
          doc_kind: 'pass',
          scope: 'crew',
          pinned: false,
          added_at: TS,
        },
        uri: makeFestivalPassSvg({
          event: g.name || g.venue,
          city: g.city,
          date: g.date,
          holder: `${leadName} PARTY`,
          access: 'AAA ALL STAGE · BOOTH · HELIPAD',
          badgeNo: `TD-${String(1040 + i)}`,
          accent: i % 2 === 0 ? '#facc15' : '#38bdf8',
          seed: 700 + i * 31,
        }),
      });
    }

    // 4. Owner Private Deal & Settlement Sheet SVG (demonstrates private scope isolation!)
    if (i < 10 || g.id === 'gig_tml_w1' || g.id === 'gig_tyo' || g.id === 'gig_ibiza') {
      const fee = g.fee || 40000;
      const dep = Math.round(fee * 0.5);
      const bal = fee - dep;
      rawDocs.push({
        file: {
          id: `file_deal_${g.id}`,
          object_id: `obj_deal_${g.id}`,
          gig_id: g.id,
          name: `PRIVATE-Settlement-${slug}-${g.currency}.svg`,
          mime: 'image/svg+xml',
          size: 12190 + i * 19,
          doc_kind: 'settlement',
          scope: 'private',
          pinned: false,
          added_at: TS,
        },
        uri: makeSettlementSheetSvg({
          artist: leadName,
          city: g.city,
          venue: g.venue,
          date: g.date,
          promoter: g.promoter || 'Partner Promoter',
          fee: `${g.currency} ${fee.toLocaleString()}`,
          deposit: `${g.currency} ${dep.toLocaleString()} PAID`,
          balance: `${g.currency} ${bal.toLocaleString()}`,
          notes: `${g.deal_type || 'Guarantee'} · Wire balance 72h prior OR cash w/ TM 30m before doors.`,
        }),
      });
    }
  }

  const files: FileRecord[] = rawDocs.map((d) => {
    registerDemoFileUrl(d.file.id, d.uri);
    return d.file;
  });

  const shares: ShareLink[] = [
    {
      key: 'demo-mex-driver',
      scope: 'gig_crew',
      gig_id: 'gig_mex',
      label: 'CDMX Driver Link — Carlos Mendoza (Deals Scrubbed)',
      enabled: true,
    },
    {
      key: 'demo-hype-crew',
      scope: 'gig_master',
      gig_id: 'gig_mex',
      label: 'Mexico City Crew Roadsheet',
      enabled: true,
    },
  ];

  return { projects, gigs, itemsByGig, people, files, shares };
}
