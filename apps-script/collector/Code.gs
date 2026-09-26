/**
 * Synthesis Coaching Lab — COLLECTOR
 * ─────────────────────────────────────────────────────────────────────────
 * Apps Script yang TERIKAT ke spreadsheet "Synthesis Data Hub".
 * Deploy sebagai Web App:  Execute as = Me,  Who has access = Anyone.
 *
 * KEAMANAN:
 *  - Script ini HANYA MENULIS. Sengaja tidak ada doGet() dan tidak ada fungsi
 *    yang mengembalikan isi spreadsheet, jadi URL publik ini tidak bisa dipakai
 *    untuk membaca data klien.
 *  - Semua nilai teks yang diawali = + - @ diberi prefix ' supaya Sheets
 *    tidak menjalankannya sebagai rumus (formula injection).
 *  - Nama form di-allowlist, clientId harus nomor WA 62xxx, ukuran dibatasi,
 *    dan ada honeypot anti-bot.
 */

const FORMS = ['Intake', 'MCTQ', 'PSQI', 'StressTidur', 'Reassessment'];
const CLIENT_SHEET = 'Klien';
const CLIENT_HEADERS = ['clientId', 'nama', 'pertamaKali', 'terakhirAktif', 'Intake', 'MCTQ', 'PSQI', 'StressTidur', 'Reassessment', 'Sesi', 'aiSentAt', 'aiAnalyzedAt'];
const MAX_BODY = 200000;   // karakter
const MAX_CELL = 5000;     // karakter per sel data
const MAX_RAW = 45000;     // batas sel Sheets = 50.000 karakter
const MAX_KEYS = 200;

function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) || '';
    if (!body || body.length > MAX_BODY) return json_({ ok: false, error: 'size' });

    let p;
    try { p = JSON.parse(body); } catch (err) { return json_({ ok: false, error: 'json' }); }
    if (!p || typeof p !== 'object') return json_({ ok: false, error: 'json' });

    // Honeypot terisi = bot. Balas "ok" supaya bot tidak tahu ditolak.
    if (p.hp) return json_({ ok: true });
    if (FORMS.indexOf(p.form) === -1) return json_({ ok: false, error: 'form' });
    if (!/^628\d{7,12}$/.test(String(p.clientId || ''))) return json_({ ok: false, error: 'client' });

    const data = (p.data && typeof p.data === 'object' && !Array.isArray(p.data)) ? p.data : {};
    // prefix ' → nomor WA disimpan sebagai teks, bukan angka
    const row = { submittedAt: new Date(), clientId: "'" + p.clientId, nama: clean_(data.nama) };
    Object.keys(data)
      .filter(k => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && !(k in row))
      .slice(0, MAX_KEYS)
      .forEach(k => { row[k] = clean_(data[k]); });
    const raw = cleanRaw_(p.raw);
    if (raw) row._raw = raw;

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      appendObject_(ss, p.form, row);
      upsertClient_(ss, p.clientId, row.nama, p.form);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Nilai aman untuk Sheets: angka tetap angka, teks dipotong + dinetralkan dari rumus.
function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  let s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  s = s.slice(0, MAX_CELL);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// raw = [{s, q, v}] → JSON string terbatas. Disimpan sebagai teks biasa.
function cleanRaw_(raw) {
  if (!Array.isArray(raw)) return '';
  const items = raw.slice(0, 400).map(x => ({
    s: String((x && x.s) || '').slice(0, 80),
    q: String((x && x.q) || '').slice(0, 300),
    v: String((x && x.v) || '').slice(0, 1500)
  }));
  let out = JSON.stringify(items);
  while (out.length > MAX_RAW && items.length) { items.pop(); out = JSON.stringify(items); }
  return "'" + out; // prefix ' → selalu disimpan sebagai teks
}

function getSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

// Tambah 1 baris; kolom baru otomatis ditambahkan, _state & _raw selalu paling kanan.
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

function upsertClient_(ss, clientId, nama, form) {
  const sh = getSheet_(ss, CLIENT_SHEET, CLIENT_HEADERS);
  const now = new Date();
  const headers = ensureHeaders_(sh, CLIENT_HEADERS);
  const col = name => headers.indexOf(name) + 1;
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, col('clientId'), last - 1, 1).getValues().map(r => String(r[0])) : [];
  const idx = ids.indexOf(String(clientId));
  if (idx === -1) {
    const values = headers.map(h =>
      h === 'clientId' ? "'" + clientId : h === 'nama' ? nama : (h === 'pertamaKali' || h === 'terakhirAktif' || h === form) ? now : '');
    sh.getRange(last + 1, 1, 1, headers.length).setValues([values]);
  } else {
    const r = idx + 2;
    if (nama) sh.getRange(r, col('nama')).setValue(nama);
    sh.getRange(r, col('terakhirAktif')).setValue(now);
    if (col(form)) sh.getRange(r, col(form)).setValue(now);
  }
}

// Tambahkan kolom yang belum ada (mis. sheet dibuat oleh versi script lama).
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
