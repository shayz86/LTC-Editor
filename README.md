# LTC Editor Football Manager 2021 — Mobile v21

Browser editor untuk file bahasa `.ltc` Football Manager 2021.

## Fokus V21: Google-first Quality

V21 mengubah strategi dari V20. Mesin utama sekarang adalah **Google Translate eksperimental/tidak resmi**, sedangkan MarianMT hanya digunakan sebagai fallback jika pengguna mengaktifkannya.

Alur:

```text
English LTC
   ↓
Proteksi placeholder [%...]
   ↓
Google Translate eksperimental
   ↓
Koreksi istilah Football Manager 2021
   ↓
Validasi placeholder
   ↓
Cache IndexedDB
   ↓
LTC hasil terjemahan
```

Jika Google gagal, terkena CORS/jaringan/rate limit, atau dibatasi, V21 dapat memakai MarianMT sebagai fallback.

## Fitur utama

- Google Translate eksperimental sebagai engine utama.
- Dua endpoint Google dicoba secara berurutan:
  - `translate.googleapis.com/translate_a/single` dengan client `gtx`.
  - `clients5.google.com/translate_a/t` dengan client `dict-chrome-ex` sebagai fallback endpoint.
- Retry otomatis dengan backoff.
- Jeda request yang dapat diatur.
- Cache IndexedDB berdasarkan teks sumber.
- Cache menggunakan namespace V21 sehingga hasil Marian dari versi lama tidak tercampur dengan hasil Google V21.
- Jika Chrome reload/crash setelah sebagian proses, string yang sudah tersimpan di cache dapat dilewati saat proses dimulai lagi.
- Placeholder `[%stadium#1-short]`, `[%date#1-long]`, dan marker FM lainnya dipertahankan byte-for-byte.
- Glossary dan koreksi istilah Football Manager 2021 tetap digunakan.
- MarianMT dapat dimuat hanya ketika dibutuhkan sebagai fallback atau dipilih sebagai engine offline.
- LTC save/rebuild engine tervalidasi dari V11 dipertahankan.

## Pengaturan yang disarankan untuk pengujian

Untuk HP Android:

- Engine: **Google Translate eksperimental**
- Batch proses: **5**
- Cache: **aktif**
- Fallback Marian: **aktif**
- Jeda Google: **700 ms**
- Retry: **2**
- Mode terjemahan: mulai dengan **Halaman saat ini** atau **Maks. 1.000 string**

Setelah kualitas dan stabilitas sesuai, baru gunakan **Semua string**.

## Tentang endpoint Google

Endpoint yang digunakan V21 bukan Google Cloud Translation API resmi. Endpoint `translate.googleapis.com/translate_a/single?client=gtx` memang masih digunakan oleh berbagai implementasi pihak ketiga, tetapi tidak merupakan kontrak API resmi yang dijamin Google. Endpoint tersebut dapat berubah, membatasi trafik, atau tidak dapat diakses dari jaringan/browser tertentu.

Karena itu V21 tidak mengklaim bahwa 178.700 string dapat diterjemahkan tanpa batas atau tanpa rate limit.

## Perkiraan waktu

Dengan jeda 700 ms dan satu request per string, 178.700 string secara teori dapat membutuhkan lebih dari 34 jam jika seluruhnya unik dan berhasil. File nyata biasanya memiliki string berulang sehingga cache dan deduplikasi dapat mengurangi jumlah request.

Karena alasan tersebut, **jangan langsung memulai 178.700 string sebelum pengujian sampel berhasil**.

## Placeholder

Contoh:

```text
The first leg will be played at [%stadium#1-short] on [%date#1-long].
```

V21 mengirim teks dengan marker sementara, lalu mengembalikan marker asli. Hasil yang diharapkan:

```text
Leg pertama akan dimainkan di [%stadium#1-short] pada [%date#1-long].
```

Jika placeholder tidak dapat dipulihkan persis, hasil Google tidak digunakan.

## LTC save engine

Engine V11 yang telah diuji pada `english.ltc` dipertahankan. Rebuild menjaga:

- ID dan urutan record.
- Marker record termasuk marker non-`0x01`.
- Gap non-indexed.
- Count record.
- Index 9-byte.
- Footer.
- Offset fisik yang dihitung ulang ketika panjang UTF-8 berubah.
- Validasi hasil sebelum download.

## Cara memakai

1. Buka `index.html` melalui GitHub Pages, Cloudflare Pages, atau server lokal.
2. Buka `english.ltc` Football Manager 2021.
3. Pilih **Google Translate eksperimental**.
4. Jalankan **Tes Google + FM2021**.
5. Pastikan contoh placeholder menghasilkan terjemahan yang masuk akal.
6. Uji **Halaman saat ini**.
7. Uji **Maks. 1.000 string**.
8. Jika stabil, gunakan **Semua string**.
9. Setelah selesai, gunakan **Simpan / Download**.

## Catatan penting

- V21 memerlukan koneksi internet untuk Google Translate.
- Tidak diperlukan API key Google Cloud.
- Tidak ada jaminan endpoint eksperimental selalu tersedia.
- Jangan menganggap endpoint ini sebagai Google Cloud Translation API resmi atau layanan unlimited.
- Project ini tidak berafiliasi dengan Sports Interactive atau SEGA.
