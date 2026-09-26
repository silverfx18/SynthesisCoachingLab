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

const FORMS = ['Intake', 'MCTQ', 'PSQI', 'StressTidur', 'Reassessment'];
const AI_SHEET = 'AnalisisAI';
const MEAS_SHEET = 'Antropometri';
// Data diri yang bisa dilengkapi/dikoreksi coach (disimpan di tab Klien)
const PROFILE_FIELDS = ['tglLahir', 'jk', 'pekerjaan', 'domisili', 'email', 'catatanKlien'];
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
    .map(r => {
      const done = FORMS.concat([SESSION_SHEET, MEAS_SHEET]).filter(f => r[f]).reduce((o, f) => { o[f] = iso_(r[f]); return o; }, {});
      const lastDataAt = Object.keys(done).map(f => done[f]).sort().pop() || '';
      const aiSentAt = iso_(r.aiSentAt);
      return {
        clientId: String(r.clientId), nama: String(r.nama || ''),
        terakhirAktif: iso_(r.terakhirAktif), pertamaKali: iso_(r.pertamaKali),
        done: done, lastDataAt: lastDataAt, aiSentAt: aiSentAt, aiAnalyzedAt: iso_(r.aiAnalyzedAt),
        // Ada data baru yang belum pernah disalin ke Claude
        needsAi: !!lastDataAt && (!aiSentAt || lastDataAt > aiSentAt)
      };
    })
    .sort((a, b) => String(b.terakhirAktif).localeCompare(String(a.terakhirAktif)));
}

function getClientData(clientId) {
  assertCoach_();
  clientId = checkId_(clientId);
  const out = { clientId: clientId, forms: {}, history: {}, sessions: [], ai: [] };
  FORMS.forEach(f => {
    const rows = readSheet_(f).filter(r => String(r.clientId) === clientId);
    if (rows.length) {
      out.history[f] = rows.slice(-20).map(toRecord_);        // urut lama → baru
      out.forms[f] = out.history[f][out.history[f].length - 1];
      out.forms[f].count = rows.length;
    }
  });
  out.measurements = readSheet_(MEAS_SHEET)
    .filter(r => String(r.clientId) === clientId)
    .map(toRecord_)
    .sort((a, b) => String(a.data.tanggalUkur).localeCompare(String(b.data.tanggalUkur)));
  const k = readSheet_(CLIENT_SHEET).filter(r => String(r.clientId) === clientId)[0] || {};
  out.profile = { nama: String(k.nama || '') };
  PROFILE_FIELDS.forEach(f => { out.profile[f] = k['profil_' + f] instanceof Date ? iso_(k['profil_' + f]).slice(0, 10) : String(k['profil_' + f] || ''); });
  out.ai = readSheet_(AI_SHEET)
    .filter(r => String(r.clientId) === clientId)
    .map(toRecord_)
    .reverse()
    .slice(0, 5);
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

// Satu baris pengukuran antropometri (diukur coach tiap sesi, atau diisi manual dari data lama).
function saveMeasurement(clientId, m) {
  assertCoach_();
  clientId = checkId_(clientId);
  m = m || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.tanggalUkur || ''))) throw new Error('Tanggal ukur wajib diisi.');
  const now = new Date();
  const id = now.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = { submittedAt: now, clientId: "'" + clientId, nama: clean_(m.nama), id: "'" + id, tanggalUkur: "'" + m.tanggalUkur };
  Object.keys(m)
    .filter(k => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && !(k in row))
    .slice(0, 80)
    .forEach(k => { row[k] = clean_(m[k]); });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = openSS_();
    appendObject_(ss, MEAS_SHEET, row);
    setClientField_(ss, clientId, 'terakhirAktif', now);
    setClientField_(ss, clientId, MEAS_SHEET, now);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, id: id };
}

// Hapus satu pengukuran (mis. salah input saat mengisi data lama).
function deleteMeasurement(clientId, id) {
  assertCoach_();
  clientId = checkId_(clientId);
  id = String(id || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = openSS_().getSheetByName(MEAS_SHEET);
    if (!sh || sh.getLastRow() < 2) return { ok: false };
    const values = sh.getDataRange().getValues();
    const h = values[0].map(String);
    for (let r = values.length - 1; r >= 1; r--) {
      if (String(values[r][h.indexOf('clientId')]) === clientId && String(values[r][h.indexOf('id')]) === id) {
        sh.deleteRow(r + 1);
        return { ok: true };
      }
    }
    return { ok: false };
  } finally {
    lock.releaseLock();
  }
}

// Coach melengkapi / mengoreksi data diri klien.
function saveProfile(clientId, profile) {
  assertCoach_();
  clientId = checkId_(clientId);
  profile = profile || {};
  const ss = openSS_();
  const nama = String(profile.nama || '').trim();
  if (nama) setClientField_(ss, clientId, 'nama', clean_(nama.slice(0, 100)));
  PROFILE_FIELDS.forEach(f => {
    if (f in profile) setClientField_(ss, clientId, 'profil_' + f, "'" + String(profile[f] || '').slice(0, 1000));
  });
  return { ok: true };
}

// Dipanggil saat coach menekan "Salin untuk Claude".
function markAiSent(clientId) {
  assertCoach_();
  clientId = checkId_(clientId);
  const now = new Date();
  setClientField_(openSS_(), clientId, 'aiSentAt', now);
  return { ok: true, at: iso_(now) };
}

// Hasil analisis Claude yang ditempel balik oleh coach.
function saveAiAnalysis(clientId, text) {
  assertCoach_();
  clientId = checkId_(clientId);
  text = String(text || '').trim();
  if (!text) throw new Error('Teks analisis kosong.');
  const now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = openSS_();
    appendObject_(ss, AI_SHEET, { submittedAt: now, clientId: "'" + clientId, analisis: clean_(text.slice(0, 45000)) });
    setClientField_(ss, clientId, 'aiAnalyzedAt', now);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, at: iso_(now) };
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
  const now = new Date();
  setClientField_(ss, clientId, 'terakhirAktif', now);
  setClientField_(ss, clientId, SESSION_SHEET, now);
}

function setClientField_(ss, clientId, field, value) {
  const sh = ss.getSheetByName(CLIENT_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const headers = ensureHeaders_(sh, [field]);
  const col = n => headers.indexOf(n) + 1;
  const ids = sh.getRange(2, col('clientId'), sh.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
  const idx = ids.indexOf(clientId);
  if (idx !== -1) sh.getRange(idx + 2, col(field)).setValue(value);
}

function ensureHeaders_(sh, wanted) {
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = wanted.filter(h => headers.indexOf(h) === -1);
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers.push(...missing);
  }
  return headers;
}
