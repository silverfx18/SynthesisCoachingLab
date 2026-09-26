# Synthesis Data Hub: Panduan Deploy

Semua assessment klien (Intake, MCTQ, PSQI, Stress-Tidur) dan catatan sesi coach disimpan di **satu spreadsheet**, dengan kunci **nomor WhatsApp klien** (format `62xxx`).

```
Halaman klien (GitHub Pages, publik)          Coach Console (hanya akun kamu)
intake / mctq / psqi / stress-tidur           Daftar klien · Ringkasan · Form Sesi · Report
        │  hanya MENULIS                               │  baca & tulis (login Google)
        ▼                                              ▼
  COLLECTOR (Apps Script, akses Anyone) ──►  "Synthesis Data Hub"  ◄── COACH (Apps Script, akses Only myself)
                                             tab: Klien · Intake · MCTQ · PSQI · StressTidur · Sesi
```

| Folder | Isi | Akses deploy |
|---|---|---|
| `collector/Code.gs` | Menerima kiriman dari halaman klien. **Tidak punya jalur baca.** | Execute as **Me**, Who has access **Anyone** |
| `coach/Code.gs` + `coach/Index.html` | Coach Console: ringkasan klien, form sesi, report | Execute as **Me**, Who has access **Only myself** |

---

## Langkah 1: Buat spreadsheet + Collector

1. Buka [sheets.new](https://sheets.new), beri nama **Synthesis Data Hub**. Tab-tabnya tidak perlu dibuat, nanti terbentuk otomatis.
2. Di spreadsheet itu: **Extensions → Apps Script**.
3. Hapus isi `Code.gs`, lalu tempel seluruh isi `apps-script/collector/Code.gs`. Simpan.
4. **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Klik **Deploy**, izinkan akses (Authorize), lalu **salin URL Web app** (berakhiran `/exec`).
6. Buka `shared.js` di repo ini, isi URL tadi:
   ```js
   const HUB_URL = "https://script.google.com/macros/s/XXXX/exec";
   ```

> Setiap kali `Code.gs` Collector diubah: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. Dengan cara ini URL-nya tetap sama.

## Langkah 2: Buat Coach Console

1. Buka [script.new](https://script.new) untuk membuat project baru yang **terpisah**. Beri nama **Synthesis Coach Console**.
2. Tempel isi `apps-script/coach/Code.gs` ke `Code.gs`.
3. **+ (Add file) → HTML**, beri nama **`Index`** (tanpa `.html`), lalu tempel isi `apps-script/coach/Index.html`.
4. **Project Settings (ikon ⚙️) → Script Properties → Add**:
   - `SHEET_ID` = ID spreadsheet Synthesis Data Hub, yaitu bagian URL di antara `/d/` dan `/edit`
   - `ALLOWED_EMAILS` (opsional) = email lain yang boleh membuka console, pisahkan dengan koma
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Only myself**
6. Simpan URL console ini untuk kamu sendiri (bookmark). **Jangan dibagikan dan jangan ditaruh di repo.**
7. Edit konstanta `REFERRAL_CONTACTS` di `Index.html` dengan kontak rujukan kamu (psikolog, psikiater, dokter).

## Langkah 3: Tes

1. Buka `intake.html?wa=08xxxxxxxxxx&nama=Tes` (pakai nomor kamu sendiri), isi sampai selesai. Harus muncul **"Tersimpan ✓"**.
2. Cek spreadsheet: tab **Klien** dan **Intake** harus berisi 1 baris.
3. Buka URL Coach Console → klien "Tes" muncul → coba Form Sesi → **Simpan Sesi** → cek tab **Sesi**.
4. Setelah semua jalan, merge branch ke `main` supaya halaman live ikut berubah.

---

## Checklist keamanan

- [ ] **Cek 2 Apps Script lama** (URL-nya dulu ada di `mctq.html` & `stress-tidur.html`). Kalau di dalamnya ada fungsi `doGet` yang mengembalikan isi sheet, data klien bisa dibaca siapa saja yang tahu URL-nya. Hapus fungsi itu atau **Archive** deployment lamanya setelah hub baru jalan.
- [ ] Collector **tidak boleh** diberi `doGet` atau fungsi yang mengembalikan data.
- [ ] Coach Console harus **Only myself**. Jangan diganti ke Anyone.
- [ ] Spreadsheet Synthesis Data Hub **jangan di-share** "Anyone with the link".
- [ ] Permintaan hapus data dari klien: hapus barisnya di semua tab (filter kolom `clientId`).

## Yang dilindungi & yang tidak

- ✅ Orang luar **tidak bisa membaca** data lewat URL Collector.
- ✅ Isian yang berbentuk rumus (`=IMAGE(...)`, `=HYPERLINK(...)`) disimpan sebagai teks biasa, tidak dijalankan.
- ✅ Coach Console butuh login Google akun kamu, plus ada cek email kedua di `assertCoach_()`.
- ⚠️ URL Collector publik, jadi orang iseng **bisa mengirim data palsu**, termasuk memakai nomor WA orang lain. Datanya tidak bocor, tapi bisa kotor. Verifikasi identitas klien saat sesi pertama.
- ⚠️ Data lama di 2 spreadsheet Apps Script sebelumnya **tidak dipindahkan otomatis**.
