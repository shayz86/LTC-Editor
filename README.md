# LTC Editor Football Manager 2021 — Mobile v20

Editor `.ltc` Football Manager 2021 yang berjalan di browser.

## Fokus V20: Hybrid Quality

V20 tidak lagi mengejar model lokal yang lebih besar seperti NLLB-200 atau M2M-100 karena model tersebut terlalu berat/lambat untuk Chrome Android.

V20 memakai dua tahap:

1. **MarianMT / OPUS-MT EN→ID** untuk menerjemahkan banyak string secara lokal dan cepat.
2. **Hybrid Quality** mendeteksi hasil Marian yang mencurigakan lalu, hanya untuk string tersebut, mencoba koreksi melalui endpoint Google Translate eksperimental tanpa API key.

Jika layanan online gagal, mode Hybrid otomatis kembali memakai hasil Marian dan proses tidak perlu berhenti.

### Mode engine

- **Hybrid Quality (Recommended)** — MarianMT untuk semua string + koreksi online hanya untuk hasil mencurigakan.
- **Offline Fast** — 100% lokal, tanpa koneksi terjemahan online.
- **Online Quality** — memakai endpoint online eksperimental; cocok untuk pengujian sampel atau jumlah terbatas, bukan untuk 178.700 string sekaligus.

### Koreksi Football Manager 2021

V20 mempertahankan glossary dan grammar khusus FM2021, termasuk istilah seperti:

- first leg / second leg → leg pertama / leg kedua
- transfer window / transfer market → bursa transfer
- transfer budget → anggaran transfer
- home fixture / away fixture → laga kandang / laga tandang
- manager → manajer
- goalkeeper → kiper
- starting lineup → susunan pemain utama
- contract offer → tawaran kontrak
- scouting report → laporan pencari bakat
- training session → sesi latihan
- press conference → konferensi pers

Placeholder `[%...]` dipertahankan persis dan divalidasi sebelum hasil diterapkan.

## Online translation: penting

Endpoint online yang dipakai V20 adalah endpoint Google Translate yang umum digunakan secara tidak resmi (`translate.googleapis.com/...client=gtx`). Ini **bukan Google Cloud Translation API resmi**, tidak dijamin selalu tersedia, dapat terkena CORS/rate limit, dan dapat berubah sewaktu-waktu.

Karena itu V20 menyediakan:

- budget koreksi online (default 500 string)
- jeda request (default 420 ms)
- cache IndexedDB
- fallback ke hasil Marian jika online gagal

Jangan menganggap layanan ini gratis/tanpa batas atau cocok untuk mengirim seluruh 178.700 string.

## LTC save engine

Engine save/rebuild yang tervalidasi dari V11 dipertahankan. Struktur LTC asli yang penting tetap dijaga:

- ID dan urutan record
- marker record termasuk marker non-`0x01`
- gap non-indexed
- count dan index 9-byte
- footer
- offset fisik dihitung ulang bila panjang UTF-8 berubah

File hasil juga divalidasi ulang sebelum diunduh.

## Cara memakai

1. Buka `index.html` melalui GitHub Pages/Cloudflare Pages atau server lokal.
2. Pilih `english.ltc` FM2021.
3. Tes terlebih dahulu dengan **🧪 Tes Model + FM2021**.
4. Untuk uji awal, gunakan **Halaman saat ini** atau **Maks. 1.000 string**.
5. Setelah hasil sesuai, gunakan **Semua string**.
6. Simpan melalui **💾 Simpan / Download**.

## Catatan Android

MarianMT dipertahankan sebagai model utama karena jauh lebih ringan daripada NLLB-200/M2M-100 di perangkat Android. WebGPU tetap opsional dan tidak diperlukan untuk mode aman WASM.

Project ini tidak berafiliasi dengan Sports Interactive atau SEGA.
