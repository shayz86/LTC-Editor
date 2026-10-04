# LTC Editor FM2011 Mobile v13 — Free Bulk Translate

Editor browser untuk file bahasa Football Manager 2011 `.ltc`.

## Fitur LTC
- Parser struktur FM2011 yang diuji pada file 20.604.686 byte / 178.700 record.
- Header 52 byte, record variable-length, record count, index 9-byte per record, footer 4 byte.
- ID, marker, flag, dan gap asli dipertahankan.
- Teks boleh bertambah/berkurang byte; offset dan index dibangun ulang.
- Validasi struktur dan round-trip sebelum download.

## Terjemahan otomatis gratis
V13 menambahkan batch translation melalui server yang kompatibel dengan LibreTranslate/Argos Translate. LibreTranslate adalah software open-source yang menggunakan Argos Translate; server self-hosted dapat dijalankan offline/gratis. Server publik dapat berubah status, memerlukan API key, atau membatasi penggunaan, jadi gunakan tombol **Tes server** sebelum memulai. Jangan menganggap server komunitas sebagai layanan permanen.

Fitur:
- batch 5/10/20 string;
- deduplicate string identik;
- translation memory/cache IndexedDB;
- pause/resume sesi (cache tetap tersimpan);
- mode halaman, maksimal 1.000, atau semua;
- placeholder `[%...]` dilindungi dan divalidasi;
- fallback ke terjemahan per-string jika separator batch rusak;
- tidak menjalankan terjemahan otomatis saat file dibuka;
- tidak membutuhkan Gemini API key.

Untuk penggunaan gratis skala besar yang stabil, jalankan LibreTranslate sendiri di PC/server dan masukkan endpoint-nya pada **Server sendiri**. Dokumentasi resmi LibreTranslate menjelaskan self-hosting/offline dan endpoint `/translate`.

## Catatan
Kualitas Argos/LibreTranslate adalah machine translation. Hasilnya dimaksudkan sebagai draft yang kemudian dirapikan manual, terutama istilah Football Manager dan kalimat yang kontekstual.
