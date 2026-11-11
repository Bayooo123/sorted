// Vercel Node.js Serverless Function behind /roadmap (roadmap.html): the
// Enough founders' roadmap to launch, drawn as a map. Same conventions as
// send-welcome-email.js: no dependencies, no package.json, built-in fetch.
//
// Why the content lives here and not in roadmap.html: the stops mention the
// shareholding split, licensing route and other internal matters. The static
// page is public; this function only answers callers holding a crew code.
//
// Env vars (Vercel project -> Settings -> Environment Variables):
//   ROADMAP_CODE_ADEBAYO, ROADMAP_CODE_LYNN, ROADMAP_CODE_JUDE
//     Each founder's personal code. The code identifies who did what.
//   BLOB_STORE_ID (+ the function's OIDC token) or BLOB_READ_WRITE_TOKEN
//     Set automatically when a private Blob store is connected to this
//     project (Vercel -> Storage). Upstash (KV_REST_API_URL/TOKEN) also works.
//     Without storage the map opens read-only on the seed below.
//   ROADMAP_AI_MODEL (optional, default anthropic/claude-haiku-5.5)
//     The guide calls Vercel AI Gateway with the function's OIDC token, so no
//     AI key is needed on Vercel. AI_GATEWAY_API_KEY overrides it if set.
//     If the gateway fails, the guide falls back to rule-based advice.
//
// API (every call sends the caller's code in header x-roadmap-code):
//   GET  /api/roadmap                       -> { state, persisted, me }
//   POST /api/roadmap { op, id, note? }     -> { state, persisted, me }
//        op = claim | done | reopen
//   POST /api/roadmap { op: 'work', text, id? } -> log other work done
//   POST /api/roadmap { op: 'guide', mode } -> { text, picks, source }
//        mode = next | easy | status

const crypto = require('crypto');

const PEOPLE = ['adebayo', 'lynn', 'jude'];
const FIRST = { adebayo: 'Adebayo', lynn: 'Lynn', jude: 'Jude' };
const MAX_LOG = 400;
const EFFORT = { 1: 'small', 2: 'medium', 3: 'big' };
// Phases of the map, in time order. The path runs through these; each task
// also carries a workstream. Definitions always come from here (not storage),
// so edits to tasks apply while saved progress is kept.
const REGIONS = [
  { id: 'p1', name: 'Build and set up', blurb: 'Now to 29 Nov' },
  { id: 'p2', name: 'Pilot', blurb: '30 Nov – 13 Dec' },
  { id: 'p3', name: 'Beta and store submission', blurb: '14 Dec – 12 Jan' },
  { id: 'p4', name: 'Launch', blurb: 'Soft launch 18–22 Jan · salary week 25–29 Jan' },
  { id: 'p5', name: 'After launch', blurb: 'February' },
];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => +iso.slice(8, 10) + ' ' + MON[+iso.slice(5, 7) - 1];

// ---------------------------------------------------------------- seed data
// From "Enough Product Roadmap" (2 Nov 2026), the allocation of functions and
// Lynn's section 6 comments, plus Lynn's added workstreams (brand, marketing,
// social, testing, pop-ups, launch essentials) built around a December pilot
// and a salary-week launch on 25-29 Jan 2027.
function seed() {
  const A = 'adebayo', L = 'lynn', J = 'jude';
  const s = (id, region, stream, title, detail, effort, crew, due, after, extra) =>
    Object.assign({ id, region, stream, title, detail, effort, crew, due, after: after || [], status: 'todo', by: null, at: null, note: '' }, extra || {});
  return {
    schema: 3,
    version: 1,
    updatedAt: null,
    updatedBy: null,
    meta: {
      pilotStart: '2026-11-30',
      pilotEnd: '2026-12-06',
      softLaunch: '2027-01-18',
      salaryWeek: '2027-01-25',
      goal: 'A live Enough app on the Google Play Store and Apple App Store, with paying customers and revenue.',
      keyDates: '20 Nov payments done; 29 Nov store upload; 13 Dec pilot review; 12 Jan store submission; 18–22 Jan soft launch; 25–29 Jan salary-week launch.',
    },
    regions: REGIONS,
    stops: [
      // ---------------- Build and set up (to 29 Nov)
      s('split', 'p1', 'Company', 'Agree the shareholding split', 'Settle the split between Adebayo and Lynn, including any vesting or option pool. It only binds once it is in the shareholders’ agreement and the CAC filings.', 2, [A, L], '2026-11-06'),
      s('name', 'p1', 'Company', 'Pick the company name and directors', 'Choose the name to reserve and who the directors are for the CAC filing.', 1, [A, L], '2026-11-08'),
      s('roles', 'p1', 'Company', 'Sign off the section 6 roles', 'Agree Lynn’s proposals: she takes company secretarial and tax filings and breaks technical ties; all three share fundraising; spend above a threshold needs Adebayo’s second approval, with Jude informed. Set the threshold.', 1, [A, L, J], '2026-11-13'),
      s('cac', 'p1', 'Company', 'Incorporate with CAC', 'Name reservation and incorporation. This gates the bank account, D-U-N-S number and payment partner.', 2, [A], '2026-11-13', ['name']),
      s('sha', 'p1', 'Company', 'Sign the shareholders’ agreement', 'Draft, negotiate and sign the founders’ and shareholders’ agreement. The split and roles must match the CAC documents.', 3, [A, L], '2026-11-13', ['split', 'roles']),
      s('reg', 'p1', 'Legal and research', 'Map the licensing route for customer funds', 'How customer funds may be held (CBN licensing, likely via a licensed partner), KYC/AML duties and data protection under the NDPA 2023. Settle this before locking the payment provider.', 3, [A], '2026-11-13'),
      s('domain', 'p1', 'Brand', 'Reserve the domain and social handles', 'Secure the domain and the Enough handles on the main social platforms now, before anything is announced.', 1, [L], '2026-11-14'),
      s('partners', 'p1', 'Legal and research', 'Shortlist payment partners', 'A shortlist of licensed partners for deposits and withdrawals, checked against the licensing route.', 2, [A, J], '2026-11-14', ['reg']),
      s('pilotsize', 'p1', 'Pilot', 'Decide pilot size and who joins', 'At least 12 people if the pilot doubles as Google’s 14-day closed test.', 1, [L], '2026-11-16'),
      s('bank', 'p1', 'Company', 'Open the corporate bank account', 'Open the company account once the CAC certificate is in hand.', 2, [L], '2026-11-20', ['cac']),
      s('duns', 'p1', 'Company', 'Apply for the D-U-N-S number', 'Needed for the Google Play organisation account. Free but can take up to 30 days, so apply the day the CAC certificate arrives.', 1, [L], '2026-11-20', ['cac']),
      s('revenue', 'p1', 'Legal and research', 'Work out revenue models', 'How Enough makes money: options, pricing and what the pilot should test.', 2, [L], '2026-11-20'),
      s('brandguide', 'p1', 'Brand', 'Logo, colours, tone of voice and brand guide', 'The core identity and a short brand guide everyone works from.', 2, [J, L], '2026-11-20'),
      s('payments', 'p1', 'Product', 'Make deposits and withdrawals work', 'Complete payment integration: money in and out of the account through the chosen partner. Key date: 20 Nov.', 3, [J, A], '2026-11-20', ['partners'], { status: 'doing', by: J, at: '2026-11-02' }),
      s('sandbox', 'p1', 'Testing', 'Test payments in the sandbox', 'Run deposits, withdrawals and failure cases end to end in the partner’s sandbox.', 2, [J], '2026-11-25', ['payments']),
      s('metrics', 'p1', 'Pilot', 'Define the pilot metrics', 'What we will measure in the pilot and what counts as success.', 1, [A, L], '2026-11-25'),
      s('strategy', 'p1', 'Marketing', 'Write the marketing strategy', 'Core audience (salaried workers, Abuja and Lagos first), positioning, key message, channels, budget and KPIs: waitlist signups, pilot activation, first-salary deposits.', 2, [L], '2026-11-27'),
      s('employers', 'p1', 'Marketing', 'Plan employer and HR partnerships', 'Salaried workers are easiest to reach through their workplaces. Decide which employers and HR teams to approach and what we offer them.', 2, [A, L], '2026-11-27'),
      s('storeassets', 'p1', 'Brand', 'App icon, store screenshots and listing copy', 'Everything the Play Store and App Store listings need.', 2, [J, L], '2026-11-27', ['brandguide']),
      s('landing', 'p1', 'Brand', 'Landing page with waitlist on the new brand', 'Bring the landing page and waitlist in line with the brand guide.', 1, [J], '2026-11-27', ['brandguide']),
      s('valuation', 'p1', 'Legal and research', 'Value the product', 'A first view of product valuation for fundraising conversations.', 2, [A, L], '2026-11-27', ['revenue']),
      s('app', 'p1', 'Product', 'Finish the MVP', 'Take the mobile app from about 40% to complete.', 3, [J], '2026-11-27', [], { status: 'doing', by: J, at: '2026-11-02' }),
      s('qa', 'p1', 'Testing', 'Internal QA and sign-off', 'Test the pilot build end to end and sign off before anyone outside the team uses it.', 2, [J], '2026-11-28', ['app', 'payments']),
      s('security', 'p1', 'Testing', 'Security review', 'Review auth, data storage and payment flows before real users touch the app.', 2, [J, A], '2026-11-29', ['app']),
      s('privacy', 'p1', 'Launch essentials', 'Privacy policy and terms of use', 'Both app stores require these before review, so they are needed by 29 Nov.', 1, [A], '2026-11-29'),
      s('banksignoff', 'p1', 'Launch essentials', 'Partner bank sign-off', 'Written sign-off from the partner bank before any live-money pilot.', 2, [A], '2026-11-29', ['partners']),
      s('support', 'p1', 'Launch essentials', 'Set up customer support', 'A WhatsApp line or support email, an FAQ, and an escalation path for failed transactions.', 2, [A], '2026-11-29'),
      s('analytics', 'p1', 'Launch essentials', 'Set up analytics', 'Track the KPIs from the marketing strategy and the pilot metrics.', 1, [J], '2026-11-29'),
      s('socialpre', 'p1', 'Social media', 'Pre-launch social content', 'From 16 Nov: teasers, “why we built Enough” founder content, budgeting tips and a waitlist push.', 2, [L], '2026-11-29'),
      s('recruit', 'p1', 'Pilot', 'Recruit and onboard pilot users', 'Bring in at least 12 opted-in testers and get them set up.', 2, [L], '2026-11-29', ['pilotsize']),
      s('stores', 'p1', 'Product', 'Upload to Play testing and TestFlight', 'Put the build on the Play Store closed testing track and Apple TestFlight. Key date: 29 Nov.', 1, [J], '2026-11-29', ['qa', 'duns', 'storeassets', 'privacy']),
      // ---------------- Pilot (30 Nov - 13 Dec)
      s('pilot', 'p2', 'Pilot', 'Run the first pilot', 'Run the pilot on the closed testing track, 30 Nov to 6 Dec.', 3, [L, J, A], '2026-12-06', ['stores', 'recruit', 'metrics', 'banksignoff', 'support']),
      s('onboardpack', 'p2', 'Brand', 'Pilot onboarding pack', 'What pilot users receive: how to start, what to try, how to give feedback.', 1, [L], '2026-12-06'),
      s('onepager', 'p2', 'Brand', 'Pitch one-pager', 'A one-page summary of Enough for investors and partners.', 1, [A, L], '2026-12-06'),
      s('popuppilot', 'p2', 'Pop-ups', 'Pilot pop-up', 'A small pop-up during the pilot, for example at an office park.', 2, [L], '2026-12-13'),
      s('socialpilot', 'p2', 'Social media', 'Pilot social content', 'Behind-the-scenes content and early-user stories from the pilot.', 1, [L], '2026-12-13'),
      s('review', 'p2', 'Pilot', 'Review the pilot and fix issues', 'Go through results and fix what broke. Key date: 13 Dec.', 2, [L, J], '2026-12-13', ['pilot']),
      // ---------------- Beta and store submission (14 Dec - 12 Jan)
      s('budget', 'p3', 'Launch essentials', 'Set the launch budget', 'What we will spend on the launch, by channel and activation.', 1, [L], '2026-12-19', ['strategy']),
      s('holiday', 'p3', 'Launch essentials', 'Plan for the holiday slowdown', 'Who covers what from 20 Dec to 3 Jan, and what must be done before the break.', 1, [A, L, J], '2026-12-19'),
      s('beta', 'p3', 'Testing', 'Fixes and a wider closed beta', 'Apply pilot fixes and open a wider closed beta.', 2, [J, L], '2027-01-08', ['review']),
      s('rc', 'p3', 'Testing', 'Release candidate', 'Lock a release candidate from the beta.', 2, [J], '2027-01-08', ['beta']),
      s('submit', 'p3', 'Product', 'Submit to the Play Store and App Store', 'Submit for review by 12 Jan, leaving a buffer for review delays.', 1, [J], '2027-01-12', ['rc', 'privacy']),
      // ---------------- Launch (13 - 29 Jan)
      s('soft', 'p4', 'Launch', 'Soft launch', 'Go live quietly, 18–22 Jan, and watch for problems before salary week.', 3, [A, L, J], '2027-01-22', ['submit']),
      s('sociallaunch', 'p4', 'Social media', 'Launch campaign', '18–29 Jan: countdown, salary-day campaign and a referral offer.', 2, [L], '2027-01-29', ['strategy']),
      s('popupsalary', 'p4', 'Pop-ups', 'Salary-week activations', 'Sign-up booths, onboarding help and giveaways during salary week.', 3, [L, A], '2027-01-29', ['budget']),
      s('salaryweek', 'p4', 'Launch', 'Salary-week launch', 'The full launch, timed to salary week, 25–29 Jan.', 3, [A, L, J], '2027-01-29', ['soft']),
      // ---------------- After launch (February)
      s('socialpost', 'p5', 'Social media', 'Post-launch content', 'Testimonials, monthly “salary week” content, and a retention and referral push.', 2, [L], '2027-02-26', ['salaryweek']),
    ],
    people: {
      adebayo: { name: 'Adebayo Gbadebo', role: 'Co-founder and CEO (also COO for now)', does: 'Vision, operations, legal and regulatory compliance, KYC/AML and fraud, data protection, partnerships incl. the BaaS partner, governance design, customer support, reconciliation of user funds, technical oversight with Jude, second approver on spend' },
      lynn: { name: 'Lynn Eugene', role: 'Co-founder and Chief Product Officer', does: 'Product roadmap and prioritisation, marketing and growth, social media, accounts and finances, governance implementation, pilots, company secretarial and tax filings, final say on technical disagreements' },
      jude: { name: 'Jude Odey', role: 'Technical Lead', does: 'Technical architecture, platform development, Android and iOS apps, UI/UX design, QA and release sign-off' },
    },
    shared: 'Shared: data and metrics (Adebayo, Lynn); people and hiring (Adebayo, Lynn); technical oversight (Adebayo, Jude); fundraising and investor relations (all three).',
    log: [],
  };
}

// ----------------------------------------------------------------- storage
// Primary: one JSON file in a private Vercel Blob store, overwritten with a
// conditional write (x-if-match on the ETag we read) so simultaneous saves
// retry instead of clobbering. REST calls mirror @vercel/blob 2.x.
const BLOB_PATH = 'enough/roadmap-map.json';
const BLOB_API = 'https://vercel.com/api/blob';
const KV_KEY = 'enough:roadmap:map';

// Blob credentials, mirroring @vercel/blob's resolveBlobAuth: either a
// read-write token (older stores), or the function's OIDC token plus
// BLOB_STORE_ID (stores connected the newer way, which is what this project has).
function blobAuth(req) {
  const rw = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (rw) return { token: rw, storeId: rw.split('_')[3] || '' };
  const storeId = (process.env.BLOB_STORE_ID || '').trim().replace(/^store_/, '');
  const oidc = (req && req.headers['x-vercel-oidc-token']) || process.env.VERCEL_OIDC_TOKEN;
  if (storeId && oidc) return { token: String(oidc).trim(), storeId };
  return null;
}
function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
const storageReady = (req) => !!(blobAuth(req) || kvConfig());

async function kv(cmd) {
  const cfg = kvConfig();
  const r = await fetch(cfg.url, { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('KV ' + r.status);
  return (await r.json()).result;
}

async function load(req) {
  const auth = blobAuth(req);
  if (auth) {
    const url = 'https://' + auth.storeId + '.private.blob.vercel-storage.com/' + BLOB_PATH + '?cache=0';
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + auth.token }, cache: 'no-store' });
    if (r.status === 404) return { state: seed(), etag: null };
    if (!r.ok) throw new Error('Blob read ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return { state: normalise(await r.json()), etag: r.headers.get('etag') };
  }
  if (kvConfig()) {
    const raw = await kv(['GET', KV_KEY]);
    return { state: raw ? normalise(JSON.parse(raw)) : seed(), etag: null };
  }
  return { state: seed(), etag: null };
}

// Task definitions always come from seed(); only progress (status, who,
// when, note) and the activity log come from storage. New tasks appear,
// edited titles/dates apply, and nothing anyone marked is lost.
function normalise(stored) {
  const fresh = seed();
  const old = Object.fromEntries((stored.stops || []).map((x) => [x.id, x]));
  fresh.stops = fresh.stops.map((x) => {
    const o = old[x.id];
    return o ? Object.assign(x, { status: o.status, by: o.by, at: o.at, note: o.note || '' }) : x;
  });
  fresh.version = stored.version || 1;
  fresh.updatedAt = stored.updatedAt || null;
  fresh.updatedBy = stored.updatedBy || null;
  fresh.log = stored.log || [];
  return fresh;
}

async function save(req, state, etag) {
  const auth = blobAuth(req);
  if (auth) {
    const headers = {
      authorization: 'Bearer ' + auth.token,
      'x-api-version': '13',
      'x-vercel-blob-store-id': auth.storeId,
      'x-vercel-blob-access': 'private',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '60',
    };
    if (etag) headers['x-if-match'] = etag;
    const r = await fetch(BLOB_API + '/?pathname=' + encodeURIComponent(BLOB_PATH), { method: 'PUT', headers, body: JSON.stringify(state) });
    if (r.ok) return true;
    const data = await r.json().catch(() => ({}));
    if (r.status === 412 || (data.error && data.error.code === 'precondition_failed')) return false;
    throw new Error('Blob write ' + r.status + ' ' + JSON.stringify(data));
  }
  await kv(['SET', KV_KEY, JSON.stringify(state)]);
  return true;
}

// ------------------------------------------------------------------ helpers
function whoIs(code) {
  if (!code) return null;
  const given = crypto.createHash('sha256').update(String(code).trim().toLowerCase()).digest();
  let found = null;
  for (const p of PEOPLE) {
    const expected = process.env['ROADMAP_CODE_' + p.toUpperCase()];
    if (!expected) continue;
    const e = crypto.createHash('sha256').update(expected.trim().toLowerCase()).digest();
    if (crypto.timingSafeEqual(given, e)) found = p;
  }
  return found;
}
const codesConfigured = () => PEOPLE.some((p) => process.env['ROADMAP_CODE_' + p.toUpperCase()]);
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const lagosToday = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const newId = () => crypto.randomBytes(6).toString('hex');

function apply(state, who, body) {
  if (body.op === 'work') {
    const text = clean(body.text, 600);
    if (!text) return 'Write what you did.';
    const linked = body.id && state.stops.some((x) => x.id === body.id) ? body.id : null;
    state.log.unshift({ id: newId(), who, stop: linked, action: 'work', note: text, date: lagosToday(), at: new Date().toISOString() });
    if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
    return null;
  }
  const stop = state.stops.find((x) => x.id === body.id);
  if (!stop) return 'Unknown task';
  const note = clean(body.note, 400);
  const today = lagosToday();
  if (body.op === 'claim') {
    stop.status = 'doing'; stop.by = who; stop.at = today;
  } else if (body.op === 'done') {
    stop.status = 'done'; stop.by = who; stop.at = today;
  } else if (body.op === 'reopen') {
    stop.status = 'todo'; stop.by = null; stop.at = null;
  } else {
    return 'Unknown action';
  }
  if (note) stop.note = note;
  state.log.unshift({ id: newId(), who, stop: stop.id, action: body.op, note, date: today, at: new Date().toISOString() });
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
  return null;
}

// ------------------------------------------------------------------- guide
function analyse(state, me) {
  const today = lagosToday();
  const byId = Object.fromEntries(state.stops.map((s) => [s.id, s]));
  const stops = state.stops.map((s) => {
    const waitingOn = s.after.filter((a) => byId[a] && byId[a].status !== 'done');
    return Object.assign({}, s, {
      open: s.status !== 'done' && waitingOn.length === 0,
      waitingOn,
      daysLeft: daysBetween(today, s.due),
      late: s.status !== 'done' && s.due < today,
      mine: s.crew.includes(me),
    });
  });
  const load = {};
  PEOPLE.forEach((p) => {
    load[p] = {
      doing: stops.filter((s) => s.status === 'doing' && s.by === p).map((s) => s.title),
      done: stops.filter((s) => s.status === 'done' && s.by === p).length,
      overdueAssigned: stops.filter((s) => s.late && s.crew.includes(p)).length,
      otherWorkLast7Days: state.log.filter((e) => e.who === p && e.action === 'work' && daysBetween(e.date, today) < 7).map((e) => e.note),
    };
  });
  return { today, stops, load };
}

// Rule-based picks: grounds the AI, and is the answer if the AI is unavailable.
function rulePicks(a, me, mode) {
  const free = a.stops.filter((s) => s.open && !(s.status === 'doing' && s.by !== me));
  const byDue = (x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0);
  if (mode === 'easy') {
    const pool = free.filter((s) => s.status !== 'doing');
    pool.sort((x, y) => x.effort - y.effort || (y.mine - x.mine) || byDue(x, y));
    return pool.slice(0, 2);
  }
  if (mode === 'next') {
    const mineDoing = a.stops.filter((s) => s.status === 'doing' && s.by === me).sort(byDue);
    const mineFree = free.filter((s) => s.mine && s.status !== 'doing').sort((x, y) => (y.late - x.late) || byDue(x, y));
    return mineDoing.slice(0, 1).concat(mineFree).slice(0, 2);
  }
  return a.stops.filter((s) => s.late).sort(byDue).slice(0, 3);
}

function ruleText(state, a, me, mode, picks) {
  const name = FIRST[me];
  const done = a.stops.filter((s) => s.status === 'done').length;
  if (mode === 'easy') {
    if (!picks.length) return 'Every open task is either taken or waiting on another task. Offer to help a teammate with theirs.';
    const p = picks[0];
    return name + ', the easiest open task is “' + p.title + '”. It’s ' + EFFORT[p.effort] + ' and nothing is blocking it, so start there.';
  }
  if (mode === 'next') {
    if (!picks.length) return 'None of your assigned tasks are open right now, ' + name + '. Pick the easiest open task, or help whoever has the most on their plate.';
    const p = picks[0];
    const when = p.late ? (-p.daysLeft) + ' days overdue' : p.daysLeft + ' days left';
    return (p.status === 'doing' ? 'Finish what you started, ' + name + ': “' : name + ', your next task is “') + p.title + '” (' + when + ').' + (picks[1] ? ' Then “' + picks[1].title + '”.' : '');
  }
  const late = a.stops.filter((s) => s.late).length;
  return done + ' of ' + a.stops.length + ' tasks done. ' + (late ? late + ' overdue' + (picks[0] ? ', starting with “' + picks[0].title + '”' : '') + '.' : 'Nothing overdue.') + ' Pilot week starts ' + fmt(state.meta.pilotStart) + '.';
}

async function aiGuide(req, state, me, mode, a, picks) {
  const token = process.env.AI_GATEWAY_API_KEY || req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return null;
  const ask = {
    next: 'They ask: what should I do next? Recommend one or two tasks, from those assigned to them where possible, finishing anything they already started first.',
    easy: 'They feel overwhelmed. Recommend the single easiest open task they could finish today, gently and without guilt.',
    status: 'They ask how the team is doing. Give a frank progress read, name the biggest risk to the pilot date, and say who could use help.',
  }[mode];
  const stops = a.stops.map((s) => ({
    id: s.id, title: s.title, phase: s.region, workstream: s.stream, effort: EFFORT[s.effort], crew: s.crew, due: s.due,
    status: s.status, by: s.by, waitingOn: s.waitingOn, open: s.open, late: s.late, daysLeft: s.daysLeft,
  }));
  const body = {
    model: process.env.ROADMAP_AI_MODEL || 'anthropic/claude-haiku-5.5',
    max_tokens: 400,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: 'You advise the three-person founding team of Enough, a Nigerian fintech app that plans a user’s salary so it lasts to payday, on their roadmap to launch. ' +
          'Speak directly to the person asking, by first name. Be warm, concrete and brief: at most 90 words, plain English, no metaphors or themed language. ' +
          'Only recommend tasks that exist, quoting their exact titles. Prefer open tasks (nothing blocking them). Respect who each task is assigned to, but anyone may help. ' +
          'Take other logged work into account when judging workload. ' +
          'Reply with JSON only: {"text": "...", "picks": ["stopId", ...]} with at most 3 picks.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          today: a.today, pilotWeek: state.meta.pilotStart + ' to ' + state.meta.pilotEnd, keyDates: state.meta.keyDates, goal: state.meta.goal,
          askedBy: { id: me, name: state.people[me].name, role: state.people[me].role, responsibilities: state.people[me].does },
          request: ask, workload: a.load, stops,
          ruleBasedSuggestion: picks.map((p) => p.id),
        }),
      },
    ],
  };
  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('AI ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { text: clean(raw, 700), picks: picks.map((p) => p.id) };
  const parsed = JSON.parse(m[0]);
  const valid = new Set(state.stops.map((s) => s.id));
  return { text: clean(parsed.text, 700), picks: (parsed.picks || []).filter((id) => valid.has(id)).slice(0, 3) };
}

// ---------------------------------------------------------------- handler
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (!codesConfigured()) {
    res.status(503).json({ error: 'Crew codes are not configured on the server yet.' });
    return;
  }
  const me = whoIs(req.headers['x-roadmap-code']);
  if (!me) {
    res.status(401).json({ error: 'That code didn’t match anyone on the crew.' });
    return;
  }
  const persisted = storageReady(req);

  try {
    if (req.method === 'GET') {
      res.status(200).json({ state: (await load(req)).state, persisted, me });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Bad request' });
      return;
    }

    if (body.op === 'guide') {
      const mode = ['next', 'easy', 'status'].includes(body.mode) ? body.mode : 'next';
      const { state } = await load(req);
      const a = analyse(state, me);
      const picks = rulePicks(a, me, mode);
      try {
        const ai = await aiGuide(req, state, me, mode, a, picks);
        if (ai && ai.text) { res.status(200).json(Object.assign({ source: 'ai' }, ai)); return; }
      } catch (e) {
        console.error('guide AI failed, using rules:', e.message);
      }
      res.status(200).json({ source: 'rules', text: ruleText(state, a, me, mode, picks), picks: picks.map((p) => p.id) });
      return;
    }

    if (!persisted) {
      res.status(503).json({ error: 'Storage isn’t connected yet, so the map can’t be saved.' });
      return;
    }
    let state;
    for (let attempt = 0; ; attempt++) {
      const loaded = await load(req);
      state = loaded.state;
      const err = apply(state, me, body);
      if (err) { res.status(400).json({ error: err }); return; }
      state.version = (state.version || 1) + 1;
      state.updatedAt = new Date().toISOString();
      state.updatedBy = me;
      if (await save(req, state, loaded.etag)) break;
      if (attempt >= 3) { res.status(409).json({ error: 'Someone else was saving at the same moment. Try again.' }); return; }
    }
    res.status(200).json({ state, persisted, me });
  } catch (e) {
    console.error('roadmap error', e);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
};
