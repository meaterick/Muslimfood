/**
 * Muslimfood feedback endpoint: a Google Apps Script web app that stores
 *   - "Add a restaurant" form submissions  -> sheet "places"
 *   - "Is this information right?" votes   -> sheet "votes"
 * and serves vote totals (GET ?counts=1) to the site.
 *
 * Setup (about 5 minutes, free): see docs/feedback/README.md.
 * Paste this whole file into Extensions → Apps Script of a new Google Sheet.
 */

// Send an e-mail to the sheet owner for every new restaurant submission.
const NOTIFY_NEW_PLACES = true;
// Votes from one place id are capped per hour, so one person cannot flood it.
const MAX_VOTES_PER_PLACE_PER_HOUR = 30;

const PLACE_FIELDS = ['name', 'address', 'phone', 'level', 'cert', 'alcohol', 'relation', 'contact', 'notes', 'lang', 'near'];
const VOTE_FIELDS = ['id', 'name', 'status', 'vote', 'reason', 'note', 'lat', 'lon'];
const LEVELS = ['C', 'O', 'Y', 'P', 'V', 'X'];
const REASONS = ['', 'closed', 'notHalal', 'alcohol', 'location', 'other'];

function sheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(['time'].concat(header).concat(name === 'places' ? ['status'] : []));
    sh.setFrozenRows(1);
  }
  return sh;
}

function clip_(v, n) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, n)
    .trim()
    // A leading = + - @ would be read as a formula by the spreadsheet.
    .replace(/^[=+\-@]/, "'$&");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (data.type === 'place') return json_(savePlace_(data));
    if (data.type === 'vote') return json_(saveVote_(data));
    return json_({ ok: false, error: 'unknown type' });
  } finally {
    lock.releaseLock();
  }
}

function savePlace_(d) {
  if (d.company) return { ok: true }; // honeypot: silently ignore bots
  const row = {
    name: clip_(d.name, 120),
    address: clip_(d.address, 300),
    phone: clip_(d.phone, 40),
    level: LEVELS.indexOf(d.level) >= 0 ? d.level : 'X',
    cert: clip_(d.cert, 120),
    alcohol: clip_(d.alcohol, 10),
    relation: clip_(d.relation, 10),
    contact: clip_(d.contact, 120),
    notes: clip_(d.notes, 1000),
    lang: clip_(d.lang, 5),
    near: clip_(d.near, 30),
  };
  if (!row.name || !row.address) return { ok: false, error: 'missing fields' };
  sheet_('places', PLACE_FIELDS).appendRow([new Date()].concat(PLACE_FIELDS.map((k) => row[k])).concat(['new']));
  if (NOTIFY_NEW_PLACES) {
    try {
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        `[Muslimfood] New place: ${row.name}`,
        PLACE_FIELDS.map((k) => `${k}: ${row[k]}`).join('\n') + `\n\n${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`,
      );
    } catch (err) {
      /* mail quota reached: the row is saved anyway */
    }
  }
  return { ok: true };
}

function saveVote_(d) {
  const id = clip_(d.id, 80);
  const vote = d.vote === 'yes' ? 'yes' : d.vote === 'no' ? 'no' : '';
  if (!/^[\w:.-]+$/.test(id) || !vote) return { ok: false, error: 'bad vote' };
  const cache = CacheService.getScriptCache();
  const key = `v:${id}`;
  const n = Number(cache.get(key) || 0);
  if (n >= MAX_VOTES_PER_PLACE_PER_HOUR) return { ok: false, error: 'too many votes' };
  cache.put(key, String(n + 1), 3600);
  const row = {
    id,
    name: clip_(d.name, 120),
    status: clip_(d.status, 3),
    vote,
    reason: REASONS.indexOf(d.reason || '') >= 0 ? d.reason || '' : 'other',
    note: clip_(d.note, 300),
    lat: Number(d.lat) || '',
    lon: Number(d.lon) || '',
  };
  sheet_('votes', VOTE_FIELDS).appendRow([new Date()].concat(VOTE_FIELDS.map((k) => row[k])));
  cache.remove('counts');
  return { ok: true };
}

/** GET ?counts=1 -> { c: { "<place id>": [yes, no], ... } } */
function doGet(e) {
  if (!e || !e.parameter || !e.parameter.counts) return json_({ ok: true });
  const cache = CacheService.getScriptCache();
  const hit = cache.get('counts');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('votes', VOTE_FIELDS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, VOTE_FIELDS.length + 1).getValues() : [];
  const idCol = 1;
  const voteCol = 1 + VOTE_FIELDS.indexOf('vote');
  const c = {};
  for (const r of values) {
    const id = r[idCol];
    if (!id) continue;
    c[id] = c[id] || [0, 0];
    if (r[voteCol] === 'yes') c[id][0]++;
    else if (r[voteCol] === 'no') c[id][1]++;
  }
  const out = JSON.stringify({ c });
  try {
    cache.put('counts', out, 600);
  } catch (err) {
    /* over 100 KB: skip the cache */
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
