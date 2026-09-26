/* ══════════════════════════════════════════════════════════════════════════
   Synthesis Coaching Lab — shared.js
   Identitas klien bersama (key = nomor WA) + satu jalur kirim data ke
   Apps Script "Collector". Dipakai oleh intake, MCTQ, PSQI, Stress-Tidur.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  // PENTING: isi dengan URL Web App Apps Script "Collector" setelah deploy
  // (lihat apps-script/README.md). Kalau kosong, data tidak dikirim ke mana pun
  // — halaman tetap berfungsi dan hasil tetap bisa di-export PDF.
  const HUB_URL = "https://script.google.com/macros/s/AKfycbzA0Emi9UU9LOjSyMeJjcAzz4rkK27ajq7Om7RPjmasZj65PlSGCBoghh8ox9PJ-w6D/exec";

  const ID_KEY = "scl_identity";

  // ── Storage aman (bisa gagal di private mode / storage diblokir) ──────────
  function readLS(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* abaikan */ }
  }

  // ── Nomor WA → format 62xxxxxxxxxx ────────────────────────────────────────
  function normalizeWA(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "62" + d.slice(1);
    else if (d.startsWith("8")) d = "62" + d;
    return /^628\d{7,12}$/.test(d) ? d : "";
  }

  function getIdentity() { return readLS(ID_KEY) || {}; }

  function saveIdentity(patch) {
    const cur = getIdentity();
    const next = Object.assign({}, cur);
    Object.keys(patch).forEach(k => { if (patch[k]) next[k] = patch[k]; });
    if (next.wa) next.wa = normalizeWA(next.wa) || next.wa;
    writeLS(ID_KEY, next);
    return next;
  }

  // Link personal dari coach: ?wa=0812...&nama=Budi&lahir=1990-05-01
  function prefillFromURL() {
    try {
      const p = new URLSearchParams(location.search);
      const patch = {};
      if (p.get("wa")) patch.wa = normalizeWA(p.get("wa"));
      if (p.get("nama")) patch.nama = p.get("nama").slice(0, 80);
      if (/^\d{4}-\d{2}-\d{2}$/.test(p.get("lahir") || "")) patch.tglLahir = p.get("lahir");
      if (Object.keys(patch).length) saveIdentity(patch);
    } catch (e) { /* abaikan */ }
  }

  function hitungUsia(tgl) {
    if (!tgl) return "";
    const t = new Date(), b = new Date(tgl);
    let a = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
    return a;
  }

  /* Isi field identitas yang masih kosong + simpan otomatis saat diubah.
     map: { nama: 'idInputNama', wa: 'idInputWA', tglLahir: 'idInputTgl', usia: 'idInputUsia' } */
  function bindIdentity(map) {
    const id = getIdentity();
    Object.keys(map).forEach(key => {
      const el = document.getElementById(map[key]);
      if (!el) return;
      if (!el.value) {
        if (key === "usia" && id.tglLahir) el.value = hitungUsia(id.tglLahir);
        else if (key === "wa" && id.wa) el.value = "0" + id.wa.slice(2);
        else if (id[key]) el.value = id[key];
      }
      if (key === "usia") return;
      el.addEventListener("change", () => saveIdentity({ [key]: el.value.trim() }));
    });
  }

  // ── Toast status pengiriman ───────────────────────────────────────────────
  function toast(msg, kind) {
    let el = document.getElementById("scl-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "scl-toast";
      el.className = "no-print";
      el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;" +
        "max-width:calc(100% - 32px);padding:10px 16px;border-radius:8px;font:600 12px Montserrat,sans-serif;" +
        "box-shadow:0 6px 24px rgba(14,24,29,.18);transition:opacity .3s;";
      document.body.appendChild(el);
    }
    const colors = { ok: ["#eafaf1", "#1e6b69"], warn: ["#fef9e7", "#8a5a00"], err: ["#fdedec", "#c0392b"], info: ["#0e181d", "#faf3ea"] };
    const c = colors[kind] || colors.info;
    el.style.background = c[0]; el.style.color = c[1]; el.style.opacity = "1";
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = "0"; }, kind === "info" ? 60000 : 5000);
  }

  let lastSent = "";

  /* Kirim ke Collector.
     form : 'Intake' | 'MCTQ' | 'PSQI' | 'StressTidur'
     data : objek datar {kolom: nilai}
     opts : { wa, nama, raw: [{s, q, v}] }  → raw = jawaban berlabel untuk Coach Console */
  async function send(form, data, opts) {
    opts = opts || {};
    const clientId = normalizeWA(opts.wa || getIdentity().wa);
    const body = {
      form: form,
      clientId: clientId,
      submittedAt: new Date().toISOString(),
      hp: "", // honeypot: harus kosong
      data: Object.assign({ nama: opts.nama || getIdentity().nama || "" }, data),
      raw: opts.raw || null
    };

    const sig = JSON.stringify([form, clientId, data]);
    if (sig === lastSent) return { ok: true, skipped: true };

    if (!HUB_URL) {
      toast("Hasil belum tersimpan ke server (belum dikonfigurasi). Silakan Export PDF & kirim ke coach.", "warn");
      return { ok: false, reason: "no-hub" };
    }
    if (!clientId) {
      toast("Nomor WA belum valid — data tidak terkirim. Silakan Export PDF.", "err");
      return { ok: false, reason: "no-wa" };
    }

    toast("Menyimpan hasil…", "info");
    try {
      // text/plain = simple request (tanpa preflight CORS) → respons tetap bisa dibaca
      const res = await fetch(HUB_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        lastSent = sig;
        toast("Tersimpan ✓ Coach sudah bisa melihat hasilmu.", "ok");
        return { ok: true };
      }
      toast("Gagal menyimpan (" + (json.error || res.status) + "). Silakan Export PDF.", "err");
      return { ok: false, reason: json.error || res.status };
    } catch (e) {
      toast("Gagal terhubung ke server. Silakan Export PDF & kirim ke coach.", "err");
      return { ok: false, reason: String(e) };
    }
  }

  prefillFromURL();

  window.SCL = { normalizeWA, getIdentity, saveIdentity, bindIdentity, hitungUsia, send, toast, readLS, writeLS };
})();
