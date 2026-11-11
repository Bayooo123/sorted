// Vercel Node.js Serverless Function behind /roadmap (roadmap.html), the
// founders' tracker for Enough. Same conventions as send-welcome-email.js:
// no dependencies, no package.json, built-in fetch only.
//
// Why the content lives here and not in roadmap.html: the roadmap and the
// allocation of functions mention the shareholding split, licensing route
// and other internal matters. The static page is public; this function
// only returns anything to a caller holding the shared passcode.
//
// Required env vars (Vercel project -> Settings -> Environment Variables):
//   ROADMAP_PASSCODE  shared passcode the three founders type to unlock.
//   BLOB_READ_WRITE_TOKEN  set automatically when the private Blob store
//     "enough-roadmap" is connected to this project (Vercel -> Storage).
//     Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) also works.
//     Without storage the page still opens on the seed data below, read-only.
//
// API (all calls need header x-roadmap-key: <passcode>):
//   GET  /api/roadmap                -> { state, persisted }
//   POST /api/roadmap { by, op, ... } -> { state, persisted }
// Writes are small operations applied server-side (not whole-state
// overwrites), so two founders editing at once rarely clobber each other.

const crypto = require('crypto');

const STORE_KEY = 'enough:roadmap:v1';
const PEOPLE = ['adebayo', 'lynn', 'jude'];
const STATUSES = ['not_started', 'in_progress', 'blocked', 'done'];
const MAX_LOG = 500;

// ---------------------------------------------------------------- seed data
// From "Enough Product Roadmap" (2 Nov 2026) and "Allocation of Functions
// Among the Founding Team" (4 Nov 2026), with Lynn's comments on section 6.
function seed() {
  const t = (id, workstream, title, start, due, status, owners, extra) =>
    Object.assign({ id, workstream, title, start, due, status, owners, note: '', critical: false }, extra || {});
  return {
    version: 1,
    updatedAt: null,
    updatedBy: null,
    meta: {
      pilotStart: '2026-11-30',
      pilotEnd: '2026-12-06',
      fallback: 'End of December 2026',
      goal: 'A live Enough app on the Google Play Store and the Apple App Store, with paying customers and revenue.',
      timelineStart: '2026-11-02',
      timelineEnd: '2026-12-13',
    },
    tasks: [
      t('shareholding', 'Company and founders', 'Agree shareholding split between the co-founders', '2026-11-02', '2026-11-06', 'not_started', ['adebayo', 'lynn'], { critical: true }),
      t('cac', 'Company and founders', 'Name reservation and incorporation with CAC', '2026-11-02', '2026-11-13', 'not_started', ['adebayo'], { critical: true }),
      t('sha', 'Company and founders', "Draft, negotiate and sign the founders' and shareholders' agreement", '2026-11-04', '2026-11-13', 'not_started', ['adebayo', 'lynn'], { critical: true }),
      t('bank', 'Company and founders', 'Open corporate bank account; apply for D-U-N-S number for store developer accounts', '2026-11-13', '2026-11-20', 'not_started', ['lynn'], { critical: true }),
      t('regulatory', 'Research', 'Legal and regulatory obligations: licensing route for holding customer funds, KYC/AML, data protection (NDPA 2023)', '2026-11-02', '2026-11-13', 'not_started', ['adebayo'], { critical: true }),
      t('revenue', 'Research', 'Revenue models', '2026-11-09', '2026-11-20', 'not_started', ['lynn']),
      t('valuation', 'Research', 'Product valuation', '2026-11-16', '2026-11-27', 'not_started', ['adebayo', 'lynn']),
      t('payments', 'Product', 'Complete payment integration: deposits into and withdrawals out of the account', '2026-11-02', '2026-11-20', 'in_progress', ['jude', 'adebayo'], { critical: true }),
      t('app', 'Product', 'Technical development of the mobile app (MVP from ~40% to complete)', '2026-11-02', '2026-11-27', 'in_progress', ['jude'], { critical: true }),
      t('stores', 'Product', 'Upload to Play Store testing track and App Store TestFlight', '2026-11-23', '2026-11-29', 'not_started', ['jude']),
      t('recruit', 'Pilot', 'Recruit and onboard pilot users (at least 12 for Google’s closed test)', '2026-11-16', '2026-11-29', 'not_started', ['lynn']),
      t('pilot', 'Pilot', 'Run first pilot test', '2026-11-30', '2026-12-06', 'not_started', ['lynn', 'jude', 'adebayo']),
      t('review', 'Pilot', 'Review pilot results and fix issues', '2026-12-07', '2026-12-13', 'not_started', ['lynn', 'jude']),
    ],
    decisions: [
      { id: 'd-split', text: 'Shareholding split between Adebayo and Lynn, including any vesting or option pool', done: false, by: null, at: null },
      { id: 'd-owners', text: 'Owner for each workstream (legal and corporate, research, payments, app build, pilot)', done: false, by: null, at: null },
      { id: 'd-name', text: 'Company name and directors for the CAC filing', done: false, by: null, at: null },
      { id: 'd-partner', text: 'Payment partner shortlist for deposits and withdrawals', done: false, by: null, at: null },
      { id: 'd-pilot-size', text: "Pilot size and who the pilot users will be (at least 12 if it doubles as Google's closed test)", done: false, by: null, at: null },
      { id: 'd-pilot-date', text: 'Pilot date: first week of December, with end of December as fallback', done: false, by: null, at: null },
    ],
    risks: [
      { title: 'Regulation before payments', text: 'The regulatory research decides how customer funds may be held. Enough should not hold deposits itself without the relevant CBN licence; the likely MVP route is a licensed partner that holds the funds. Settle this before locking the payment provider.' },
      { title: 'Store accounts need the company', text: 'A Google Play organisation account needs a D-U-N-S number, which is free but can take up to 30 days to issue. Apply the day the CAC certificate arrives.' },
      { title: "Google's 14-day test", text: 'A new personal Play account must run a closed test with at least 12 opted-in testers for 14 continuous days before production release. The pilot can double as this test if it runs on the closed testing track with 12 or more pilot users.' },
      { title: 'Agreement before equity is real', text: "The shareholding split only binds once it is written into the founders' and shareholders' agreement and reflected in the CAC filings." },
      { title: 'Tight window', text: 'With four weeks to the pilot, any slip in payments or the app build pushes the pilot to the end-of-December fallback.' },
    ],
    people: {
      adebayo: {
        name: 'Adebayo Gbadebo',
        role: 'Co-founder and Chief Executive Officer (also performing COO functions)',
        short: 'CEO',
        functions: [
          'Vision and direction',
          'Operations and growth',
          'Legal and regulatory compliance',
          'KYC, AML and fraud monitoring',
          'Data protection',
          'Partnerships and external relations, including the banking-as-a-service partner',
          'Corporate governance design',
          'Customer support and complaints',
          "Reconciliation of user funds against the BaaS partner's records",
          'Technical oversight, with Jude Odey',
        ],
      },
      lynn: {
        name: 'Lynn Eugene',
        role: 'Co-founder and Chief Product Officer',
        short: 'CPO',
        functions: [
          'Product management: roadmap, feature prioritisation, product decisions',
          'Marketing and growth',
          'Social media',
          'Accounts and finances',
          'Governance implementation',
          'Pilots, including selection of pilot participants',
          'Company secretarial and tax filings (from section 6)',
          'Final say where Adebayo and Jude disagree on a technical matter (from section 6)',
        ],
      },
      jude: {
        name: 'Jude Odey',
        role: 'Technical Lead',
        short: 'Tech Lead',
        functions: [
          'Technical architecture and infrastructure',
          'Product development of the Enough platform',
          'Mobile development (Android and iOS)',
          'UI/UX design',
          'Quality assurance and release sign-off',
        ],
      },
    },
    shared: [
      { fn: 'Data and metrics', who: ['adebayo', 'lynn'], scope: 'Defining, tracking and reporting key performance indicators, including pilot metrics' },
      { fn: 'People and hiring', who: ['adebayo', 'lynn'], scope: 'Recruitment, engagement terms and team matters' },
      { fn: 'Technical oversight', who: ['adebayo', 'jude'], scope: 'Review of technical priorities, progress and decisions' },
      { fn: 'Fundraising and investor relations', who: ['adebayo', 'lynn', 'jude'], scope: 'Pitch preparation, outreach and personal relationships, until the team can bring in people with those skills' },
    ],
    deferred: [
      { item: 'Company secretarial and tax filings', resolution: 'Lynn Eugene takes these on from incorporation', who: ['lynn'], status: 'proposed', source: "Lynn's comment" },
      { item: 'Fundraising and investor relations', resolution: 'All three: pitch preparation, outreach and personal relationships, until there is enough traction to bring in people with those skills', who: ['adebayo', 'lynn', 'jude'], status: 'proposed', source: "Lynn's comment" },
      { item: 'Approval of expenditure', resolution: 'Payments above an agreed threshold need a second approval from Adebayo, with Jude kept informed. Threshold still to be set.', who: ['adebayo', 'lynn'], status: 'proposed', source: "Lynn's comment" },
      { item: 'Technical decisions', resolution: 'Where Adebayo and Jude disagree on a technical matter, Lynn makes the final call', who: ['lynn'], status: 'proposed', source: "Lynn's comment" },
    ],
    log: [
      { id: 'seed-1', who: 'adebayo', text: 'Prepared the Enough product roadmap with Lynn', task: null, date: '2026-11-02', kind: 'manual' },
      { id: 'seed-2', who: 'lynn', text: 'Co-prepared the Enough product roadmap', task: null, date: '2026-11-02', kind: 'manual' },
      { id: 'seed-3', who: 'adebayo', text: 'Drafted the allocation of functions among the founding team', task: 'd-owners', date: '2026-11-04', kind: 'manual' },
      { id: 'seed-4', who: 'lynn', text: 'Commented on section 6: took company secretarial/tax filings and technical tie-breaks; proposed shared fundraising and a second approver on spend', task: null, date: '2026-11-11', kind: 'manual' },
    ],
  };
}

// ----------------------------------------------------------------- storage
// Primary: a private Vercel Blob store (BLOB_READ_WRITE_TOKEN, set when the
// store is connected to this project). One JSON file, overwritten with a
// conditional write (x-if-match on the ETag we read), so two founders saving
// at the same moment can't silently overwrite each other: the loser retries.
// REST calls mirror what @vercel/blob 2.x sends; kept dependency-free on purpose.
// Fallback: Upstash Redis REST (KV_REST_API_URL / KV_REST_API_TOKEN).
const BLOB_PATH = 'enough/roadmap.json';
const BLOB_API = 'https://vercel.com/api/blob';

function blobToken() { return process.env.BLOB_READ_WRITE_TOKEN || null; }
function blobStoreId(token) { return token.split('_')[3] || ''; }

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
function storageReady() { return !!(blobToken() || kvConfig()); }

async function kv(cmd) {
  const cfg = kvConfig();
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('KV ' + r.status);
  return (await r.json()).result;
}

// Returns { state, etag }.
async function load() {
  const token = blobToken();
  if (token) {
    const url = 'https://' + blobStoreId(token) + '.private.blob.vercel-storage.com/' + BLOB_PATH + '?cache=0';
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (r.status === 404) return { state: seed(), etag: null };
    if (!r.ok) throw new Error('Blob read ' + r.status);
    return { state: await r.json(), etag: r.headers.get('etag') };
  }
  if (kvConfig()) {
    const raw = await kv(['GET', STORE_KEY]);
    return { state: raw ? JSON.parse(raw) : seed(), etag: null };
  }
  return { state: seed(), etag: null };
}

// Returns true when written, false on a concurrent-write conflict.
async function save(state, etag) {
  const token = blobToken();
  if (token) {
    const headers = {
      authorization: 'Bearer ' + token,
      'x-api-version': '13',
      'x-vercel-blob-store-id': blobStoreId(token),
      'x-vercel-blob-access': 'private',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '60',
    };
    if (etag) headers['x-if-match'] = etag;
    const r = await fetch(BLOB_API + '/?pathname=' + encodeURIComponent(BLOB_PATH), {
      method: 'PUT', headers, body: JSON.stringify(state),
    });
    if (r.ok) return true;
    const data = await r.json().catch(() => ({}));
    if (r.status === 412 || (data.error && data.error.code === 'precondition_failed')) return false;
    throw new Error('Blob write ' + r.status + ' ' + JSON.stringify(data));
  }
  await kv(['SET', STORE_KEY, JSON.stringify(state)]);
  return true;
}

// --------------------------------------------------------------- helpers
function authorised(req) {
  const expected = process.env.ROADMAP_PASSCODE || '';
  const given = String(req.headers['x-roadmap-key'] || '');
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const lagosToday = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);
const newId = () => crypto.randomBytes(6).toString('hex');

function addLog(state, entry) {
  state.log.unshift(Object.assign({ id: newId(), date: lagosToday(), task: null, kind: 'auto' }, entry));
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
}

const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };

// Apply one operation. Returns an error string, or null on success.
function apply(state, body) {
  const by = body.by;
  if (!PEOPLE.includes(by)) return 'Unknown founder';
  const findTask = (id) => state.tasks.find((x) => x.id === id);

  switch (body.op) {
    case 'task': {
      const task = findTask(body.id);
      if (!task) return 'Unknown task';
      const p = body.patch || {};
      if (p.status !== undefined) {
        if (!STATUSES.includes(p.status)) return 'Bad status';
        if (p.status !== task.status) {
          addLog(state, { who: by, task: task.id, text: 'Moved “' + task.title + '” to ' + STATUS_LABEL[p.status] });
          task.status = p.status;
          if (p.status === 'done') { task.doneAt = lagosToday(); task.doneBy = by; }
        }
      }
      if (p.owners !== undefined) {
        if (!Array.isArray(p.owners) || !p.owners.every((o) => PEOPLE.includes(o))) return 'Bad owners';
        task.owners = PEOPLE.filter((o) => p.owners.includes(o));
      }
      if (p.note !== undefined) task.note = clean(p.note, 1000);
      if (p.due !== undefined) { if (!isDate(p.due)) return 'Bad date'; task.due = p.due; }
      task.updatedAt = new Date().toISOString();
      task.updatedBy = by;
      return null;
    }
    case 'log': {
      const text = clean(body.text, 600);
      if (!text) return 'Write what you did';
      const who = PEOPLE.includes(body.who) ? body.who : by;
      const task = body.task && (findTask(body.task) || state.decisions.find((d) => d.id === body.task)) ? body.task : null;
      addLog(state, { who, text, task, date: isDate(body.date) ? body.date : lagosToday(), kind: 'manual', addedBy: by });
      state.log.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      return null;
    }
    case 'unlog': {
      const i = state.log.findIndex((e) => e.id === body.id);
      if (i < 0) return 'Unknown entry';
      state.log.splice(i, 1);
      return null;
    }
    case 'decision': {
      const d = state.decisions.find((x) => x.id === body.id);
      if (!d) return 'Unknown decision';
      d.done = !!body.done;
      d.by = d.done ? by : null;
      d.at = d.done ? lagosToday() : null;
      if (body.note !== undefined) d.note = clean(body.note, 600);
      if (d.done) addLog(state, { who: by, task: d.id, text: 'Closed decision: ' + d.text });
      return null;
    }
    case 'deferred': {
      const d = state.deferred[body.index];
      if (!d) return 'Unknown item';
      if (!['proposed', 'agreed'].includes(body.status)) return 'Bad status';
      d.status = body.status;
      d.agreedBy = body.status === 'agreed' ? by : null;
      if (body.status === 'agreed') addLog(state, { who: by, task: null, text: 'Marked allocation item agreed: ' + d.item });
      return null;
    }
    default:
      return 'Unknown operation';
  }
}

// ---------------------------------------------------------------- handler
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (!process.env.ROADMAP_PASSCODE) {
    res.status(503).json({ error: 'Roadmap passcode is not configured on the server.' });
    return;
  }
  if (!authorised(req)) {
    res.status(401).json({ error: 'Wrong passcode.' });
    return;
  }

  const persisted = storageReady();
  try {
    if (req.method === 'GET') {
      res.status(200).json({ state: (await load()).state, persisted });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!persisted) {
      res.status(503).json({ error: 'Storage is not connected, so changes cannot be saved yet.' });
      return;
    }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    // read, apply, conditional write; retry if someone else saved in between
    let state;
    for (let attempt = 0; ; attempt++) {
      const loaded = await load();
      state = loaded.state;
      const err = apply(state, body);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
      state.version = (state.version || 1) + 1;
      state.updatedAt = new Date().toISOString();
      state.updatedBy = body.by;
      if (await save(state, loaded.etag)) break;
      if (attempt >= 3) {
        res.status(409).json({ error: 'Someone else was saving at the same moment. Try again.' });
        return;
      }
    }
    res.status(200).json({ state, persisted });
  } catch (e) {
    console.error('roadmap error', e);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
};
