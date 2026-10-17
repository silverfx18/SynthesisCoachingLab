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

  // Nomor WhatsApp coach untuk tombol "Konsultasi" di halaman hasil publik (format 62xxx).
  // Kosongkan kalau tidak ingin menampilkan tombol.
  const COACH_WA = "";

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

  /* ── Tampilan hasil ────────────────────────────────────────────────────────
     Semua pengisi (klien & publik) hanya melihat HASIL SINGKAT: label + deskripsi.
     Hasil lengkap (angka, saran, analisis) hanya untuk coach: tambahkan ?hasil=1.
     Mode klien = dibuka lewat link personal (?wa=), diingat di perangkat ini;
     dipakai untuk teks penutup ("dibahas saat sesi") dan autofill identitas. */
  const MODE_KEY = "scl_mode_klien";
  function isClientMode() {
    try { if (new URLSearchParams(location.search).get("wa")) writeLS(MODE_KEY, true); } catch (e) { /* abaikan */ }
    return readLS(MODE_KEY) === true;
  }
  function showFullResult() {
    try { return new URLSearchParams(location.search).get("hasil") === "1"; } catch (e) { return false; }
  }
  function escH(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Blok "Hasil singkat": gambaran umum tanpa angka mentah & saran spesifik.
  // moreHtml = blok tambahan dari briefBlock / briefTags / briefSpectrum (sudah di-escape).
  function briefHtml(title, desc, img, moreHtml) {
    return `<div style="padding:18px 24px;border-bottom:1px solid #e7e2da">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:${desc ? 10 : 0}px">
        ${img ? `<img src="${escH(img)}" alt="${escH(title)}" style="width:84px;height:84px;object-fit:contain;flex-shrink:0;border-radius:10px">` : ""}
        <div style="min-width:0">
          <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2F9794;margin-bottom:6px">Gambaran Hasilmu</div>
          <div style="font-size:17px;font-weight:800;line-height:1.3;color:#1e6b69">${escH(title)}</div>
        </div>
      </div>
      ${desc ? `<div style="font-size:12.5px;line-height:1.7;color:#33433f">${escH(desc)}</div>` : ""}
      ${moreHtml || ""}
    </div>`;
  }
  const TONE = { baik: ["#1e8449", "#eafaf1"], sedang: ["#9a6b00", "#fef5e0"], perhatian: ["#b03a2e", "#fdedec"] };
  function briefLabel(label) {
    return `<div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2F9794;margin-bottom:6px">${escH(label)}</div>`;
  }
  // chip = { t: 'Sedang', tone: 'baik' | 'sedang' | 'perhatian' } (opsional)
  function briefBlock(label, text, chip) {
    const c = chip && (TONE[chip.tone] || TONE.sedang);
    return `<div style="margin-top:14px;padding-top:12px;border-top:1px dashed #e7e2da">
      ${briefLabel(label)}
      ${c ? `<span style="display:inline-block;font-size:11px;font-weight:700;color:${c[0]};background:${c[1]};padding:3px 10px;border-radius:20px;margin-bottom:6px">${escH(chip.t)}</span>` : ""}
      ${text ? `<div style="font-size:12px;line-height:1.7;color:#33433f">${escH(text)}</div>` : ""}
    </div>`;
  }
  function briefTags(label, arr, note) {
    if (!arr || !arr.length) return "";
    return `<div style="margin-top:14px;padding-top:12px;border-top:1px dashed #e7e2da">
      ${briefLabel(label)}
      <div style="display:flex;flex-wrap:wrap;gap:6px">${arr.map(t => `<span style="font-size:11.5px;font-weight:600;color:#1e6b69;background:#e8f5f4;padding:4px 10px;border-radius:20px">${escH(t)}</span>`).join("")}</div>
      ${note ? `<div style="font-size:11px;line-height:1.6;color:#6b7d7c;margin-top:6px">${escH(note)}</div>` : ""}
    </div>`;
  }
  // Bar spektrum dengan penanda posisi (pct 0–100), tanpa angka
  function briefSpectrum(label, pct, ends) {
    const p = Math.min(Math.max(Number(pct) || 50, 3), 97);
    return `<div style="margin-top:14px;padding-top:12px;border-top:1px dashed #e7e2da">
      ${briefLabel(label)}
      <div style="position:relative;height:10px;border-radius:6px;background:linear-gradient(90deg,#f5b041,#7fb3a8,#5b4e8c);margin:10px 0 6px">
        <div style="position:absolute;top:50%;left:${p}%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#fff;border:3px solid #0e181d"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;font-weight:600;color:#6b7d7c">${(ends || []).map(e => `<span>${escH(e)}</span>`).join("")}</div>
    </div>`;
  }

  // Teks penutup: klien → dibahas saat sesi; publik → gambaran umum + ajakan ngobrol (tanpa nada jualan)
  function closingText() {
    return isClientMode()
      ? "Langkah yang pas untuk kondisimu akan kita bahas bersama saat sesi."
      : "Ini gambaran umum, bukan diagnosis. Kalau ingin tahu langkah yang pas untuk kondisimu, kamu bisa ngobrol dengan coach.";
  }
  function consultButtonHtml() {
    if (isClientMode() || !COACH_WA) return "";
    const msg = encodeURIComponent("Halo coach, saya baru mengisi assessment di Synthesis Coaching Lab dan ingin ngobrol soal hasilnya.");
    return `<a href="https://wa.me/${COACH_WA}?text=${msg}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;background:#2F9794;color:#fff;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:10px 16px;border-radius:8px">💬 Ngobrol dengan Coach</a>`;
  }

  // Kartu "terima kasih" + hasil singkat + ringkasan jawaban
  function clientThanksHtml(items, extraHtml) {
    const rows = (items || []).filter(x => x && x.v !== "" && x.v != null)
      .map(x => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:6px 0;border-bottom:1px dashed #e7e2da;font-size:11.5px;line-height:1.45"><span style="color:#6b7d7c">${escH(x.q)}</span><span style="font-weight:600">${escH(x.v)}</span></div>`).join("");
    return `<div class="scl-thanks" style="background:#fff;border:1px solid #e7e2da;border-radius:14px;overflow:hidden;font-family:Montserrat,sans-serif;color:#0e181d">
      <div style="background:#eafaf1;border-bottom:1px solid #e7e2da;padding:20px 24px">
        <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1e6b69;margin-bottom:6px">Synthesis Coaching Lab</div>
        <div style="font-size:18px;font-weight:800;margin-bottom:6px">Terima kasih, jawabanmu sudah diterima ✓</div>
        <div style="font-size:12px;line-height:1.7;color:#33433f">${escH(closingText())} Kamu bisa menyimpan salinan jawaban lewat tombol PDF.</div>
        ${consultButtonHtml()}
      </div>
      ${extraHtml || ""}
      ${rows ? `<div style="padding:16px 24px 20px"><div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2F9794;margin-bottom:8px">Ringkasan Jawabanmu</div>${rows}</div>` : ""}
    </div>`;
  }

  // Sembunyikan kartu hasil asli & tampilkan kartu terima kasih di posisinya (bisa dipanggil berulang)
  function showClientThanks(resultCardId, items, extraHtml) {
    const card = document.getElementById(resultCardId);
    if (!card) return;
    card.style.display = "none";
    let box = document.getElementById("sclThanks");
    if (!box) { box = document.createElement("div"); box.id = "sclThanks"; card.parentNode.insertBefore(box, card.nextSibling); }
    box.className = card.className.replace(/\bno-print\b/, "");
    box.style.padding = "0"; box.style.border = "none"; box.style.boxShadow = "none"; box.style.background = "transparent";
    box.innerHTML = clientThanksHtml(items, extraHtml);
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

  window.SCL = { normalizeWA, getIdentity, saveIdentity, bindIdentity, hitungUsia, send, toast, readLS, writeLS, isClientMode, showFullResult, briefHtml, briefBlock, briefTags, briefSpectrum, closingText, consultButtonHtml, clientThanksHtml, showClientThanks };
})();
