/**
 * Synthesis Coaching Lab — COACH CONSOLE
 * ─────────────────────────────────────────────────────────────────────────
 * Apps Script STANDALONE (project terpisah dari Collector).
 * Deploy sebagai Web App:  Execute as = Me,  Who has access = Only myself.
 *
 * Script Properties (Project Settings → Script Properties):
 *   SHEET_ID        = ID spreadsheet "Synthesis Data Hub" (bagian URL di antara /d/ dan /edit)
 *   ALLOWED_EMAILS  = (opsional) email yang boleh akses, pisahkan dengan koma.
 *                     Kalau kosong, hanya pemilik script.
 *
 * Karena akses "Only myself", Google mewajibkan login dengan akun kamu.
 * assertCoach_() adalah lapisan kedua kalau suatu saat setelan deploy berubah.
 */

const FORMS = ['Intake', 'MCTQ', 'PSQI', 'StressTidur'];
const SESSION_SHEET = 'Sesi';
const CLIENT_SHEET = 'Klien';
const MAX_CELL = 5000;
const MAX_RAW = 45000;

function doGet() {
  assertCoach_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Coach Console — Synthesis Coaching Lab')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ── API untuk Index.html (google.script.run) ────────────────────────────── */

function getClients() {
  assertCoach_();
  const rows = readSheet_(CLIENT_SHEET);
  return rows
    .map(r => ({
      clientId: String(r.clientId), nama: String(r.nama || ''),
      terakhirAktif: iso_(r.terakhirAktif), pertamaKali: iso_(r.pertamaKali),
      done: FORMS.concat([SESSION_SHEET]).filter(f => r[f]).reduce((o, f) => { o[f] = iso_(r[f]); return o; }, {})
    }))
    .sort((a, b) => String(b.terakhirAktif).localeCompare(String(a.terakhirAktif)));
}

function getClientData(clientId) {
  assertCoach_();
  clientId = checkId_(clientId);
  const out = { clientId: clientId, forms: {}, sessions: [] };
  FORMS.forEach(f => {
    const rows = readSheet_(f).filter(r => String(r.clientId) === clientId);
    if (rows.length) {
      out.forms[f] = toRecord_(rows[rows.length - 1]);
      out.forms[f].count = rows.length;
    }
  });
  out.sessions = readSheet_(SESSION_SHEET)
    .filter(r => String(r.clientId) === clientId)
    .map(toRecord_)
    .reverse()
    .slice(0, 10);
  return out;
}

/* payload = { data: {kunci: nilai}, raw: [{s,q,v}], state: {…jawaban mentah form} } */
function saveSession(clientId, payload) {
  assertCoach_();
  clientId = checkId_(clientId);
  payload = payload || {};
  const data = (payload.data && typeof payload.data === 'object') ? payload.data : {};
  const row = { submittedAt: new Date(), clientId: "'" + clientId, nama: clean_(data.nama) };
  Object.keys(data)
    .filter(k => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && !(k in row))
    .slice(0, 300)
    .forEach(k => { row[k] = clean_(data[k]); });
  row._state = "'" + JSON.stringify(payload.state || {}).slice(0, MAX_RAW);
  row._raw = cleanRaw_(payload.raw);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = openSS_();
    appendObject_(ss, SESSION_SHEET, row);
    touchClient_(ss, clientId, row.nama);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, savedAt: iso_(row.submittedAt) };
}

/* ── Internal ─────────────────────────────────────────────────────────────── */

function assertCoach_() {
  const user = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const allowed = String(PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!user || (user !== owner && allowed.indexOf(user) === -1)) throw new Error('Akses ditolak.');
}

function openSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID belum diisi di Script Properties.');
  return SpreadsheetApp.openById(id);
}

function checkId_(id) {
  id = String(id || '');
  if (!/^628\d{7,12}$/.test(id)) throw new Error('clientId tidak valid.');
  return id;
}

function iso_(v) {
  if (v instanceof Date) return v.toISOString();
  return v === null || v === undefined ? '' : String(v);
}

function readSheet_(name) {
  const sh = openSS_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
}

// Baris sheet → objek yang aman dikirim ke browser (tanggal jadi ISO string).
function toRecord_(r) {
  const data = {};
  let raw = null, state = null;
  Object.keys(r).forEach(k => {
    if (k === '_raw') { try { raw = JSON.parse(r[k] || 'null'); } catch (e) { raw = null; } }
    else if (k === '_state') { try { state = JSON.parse(r[k] || 'null'); } catch (e) { state = null; } }
    else data[k] = r[k] instanceof Date ? r[k].toISOString() : r[k];
  });
  return { submittedAt: iso_(r.submittedAt), data: data, raw: raw, state: state };
}

function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  let s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  s = s.slice(0, MAX_CELL);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function cleanRaw_(raw) {
  if (!Array.isArray(raw)) return '';
  const items = raw.slice(0, 400).map(x => ({
    s: String((x && x.s) || '').slice(0, 80),
    q: String((x && x.q) || '').slice(0, 300),
    v: String((x && x.v) || '').slice(0, MAX_CELL)
  }));
  let out = JSON.stringify(items);
  while (out.length > MAX_RAW && items.length) { items.pop(); out = JSON.stringify(items); }
  return "'" + out;
}

function getSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Sama dengan Collector: kolom baru otomatis, _state & _raw selalu paling kanan.
function appendObject_(ss, sheetName, obj) {
  const sh = getSheet_(ss, sheetName, ['submittedAt', 'clientId', 'nama']);
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const tail = ['_state', '_raw'];
  const newKeys = Object.keys(obj).filter(k => headers.indexOf(k) === -1);
  const insertKeys = newKeys.filter(k => tail.indexOf(k) === -1);
  const firstTail = headers.findIndex(h => tail.indexOf(h) !== -1);
  if (insertKeys.length) {
    if (firstTail !== -1) {
      sh.insertColumnsBefore(firstTail + 1, insertKeys.length);
      sh.getRange(1, firstTail + 1, 1, insertKeys.length).setValues([insertKeys]);
      headers.splice(firstTail, 0, ...insertKeys);
    } else {
      sh.getRange(1, headers.length + 1, 1, insertKeys.length).setValues([insertKeys]);
      headers.push(...insertKeys);
    }
  }
  tail.filter(k => newKeys.indexOf(k) !== -1).forEach(k => {
    sh.getRange(1, headers.length + 1).setValue(k);
    headers.push(k);
  });
  const values = headers.map(h => (h in obj ? obj[h] : ''));
  sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([values]);
}

function touchClient_(ss, clientId, nama) {
  const sh = ss.getSheetByName(CLIENT_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = n => headers.indexOf(n) + 1;
  const ids = sh.getRange(2, col('clientId'), sh.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
  const idx = ids.indexOf(clientId);
  if (idx === -1) return;
  const now = new Date();
  sh.getRange(idx + 2, col('terakhirAktif')).setValue(now);
  if (col(SESSION_SHEET)) sh.getRange(idx + 2, col(SESSION_SHEET)).setValue(now);
}
