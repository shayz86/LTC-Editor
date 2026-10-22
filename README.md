# LTC Editor Football Manager 2021 — Mobile v28

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

## Fitur V26: kata ganti orang, terjemahan hasil pencarian, dan pencarian posisi

Sebelum teks dikirim ke Google Translate atau MarianMT, placeholder khusus berikut dikonversi menjadi kata bahasa Inggris biasa agar diterjemahkan sesuai konteks:

- `[%person#1-I]` → `I` → biasanya diterjemahkan menjadi `saya`.
- `[%person#1-you]` → `you` → biasanya diterjemahkan menjadi `kamu/Anda` sesuai konteks.
- `[%person#1-he]`, `[%person#1-him]`, `[%person#1-his]` → kata ganti laki-laki.
- `[%person#1-she]`, `[%person#1-her]`, `[%person#1-hers]` → kata ganti perempuan.
- `[%person#1-it]`, `[%person#1-its]`, `[%person#1-they]`, `[%person#1-them]`, `[%person#1-their]`, dan bentuk lain termasuk `we/us/our`, `mine`, `yours`, `theirs`.
- `[%person#1-your]` → `your` → diterjemahkan sebagai bentuk kepemilikan sesuai susunan kalimat.

Pola ini berlaku untuk nomor person lain juga, misalnya `[%person#2-you]`. Placeholder FM2021 lain seperti `[%stadium#1-short]` dan `[%date#1-long]` tetap dilindungi dan harus dipertahankan persis. Hasil untuk `your` bergantung konteks kalimat; periksa hasil terjemahan karena bentuk kepemilikan bahasa Indonesia bisa memerlukan susunan kata yang berbeda.

- Mode terjemahan `Halaman saat ini` menerjemahkan halaman yang sedang terlihat, termasuk hasil pencarian. Mode `Halaman hasil search saja` membatasi proses hanya pada halaman hasil pencarian aktif.
- Pencarian dapat difilter agar frasa berada di posisi awal atau posisi akhir string.

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


## Catatan versi V24

V24 menambahkan ekspansi placeholder pronoun `person#N-I`, `person#N-you`, dan `person#N-your` sebelum proses terjemahan, baik Google-first maupun MarianMT. Mesin penyimpanan/rebuild LTC tidak diubah.


V25 juga mengonversi placeholder `[%person#N-me]` dan `[%person#N-my]` menjadi kata Inggris `me` dan `my` sebelum terjemahan. Placeholder kata ganti yang dikenali: I, you, me, my, your. Placeholder LTC lainnya tetap dipertahankan.


## Catatan versi V26

- Menambahkan placeholder kata ganti orang: `I`, `me`, `my`, `mine`, `you`, `your`, `yours`, `we`, `us`, `our`, `ours`, `he`, `him`, `his`, `she`, `her`, `hers`, `it`, `its`, `they`, `them`, `their`, `theirs`. Placeholder ini diubah menjadi kata Inggris biasa sebelum diterjemahkan. Placeholder LTC lain tetap dipertahankan.
- Mode terjemahan `Halaman saat ini` sekarang menerjemahkan indeks yang sedang terlihat, termasuk jika daftar sedang difilter dengan search.
- Mode `Halaman hasil search saja` secara eksplisit hanya menerjemahkan hasil pada halaman pencarian yang sedang terlihat. Jika tidak ada pencarian aktif, mode ini tidak membuat antrian.
- Pencarian memiliki opsi `Posisi awal string` dan `Posisi akhir string`. Keduanya memeriksa awal/akhir isi string setelah spasi tepi diabaikan. Mode ini bisa dipakai bersama filter placeholder.


## Fitur V28: tampilan teks non-string dan alat massal

- Panel `Header dan teks non-string LTC` menampilkan rangkaian ASCII terbaca dari header dan celah di luar string terindeks, termasuk metadata seperti `Bahasa Indonesia By : OmJhon` jika ada. Data biner/index tidak ditampilkan sebagai teks palsu.
- `Hapus di semua string`: menghapus semua kemunculan literal, misalnya `{s}`, dari seluruh string terindeks.
- `Ganti semua (kata utuh)`: mengganti kata/frasa utuh di semua string, misalnya `match` → `pertandingan`, tanpa mengubah kata seperti `matches` atau `matchday`.
- `Ubah placeholder kata ganti → Indonesia`: mengubah suffix placeholder kata ganti menjadi teks Indonesia dan menghapus token placeholder terkait di seluruh string. Operasi ini destruktif terhadap token tersebut, jadi ada konfirmasi sebelum berjalan.
- Operasi massal menampilkan progres, menerapkan perubahan ke semua record, dan hasilnya tetap harus disimpan/diunduh untuk menjadi file baru.
- Bagian header/non-string hanya ditampilkan; tidak diedit oleh alat massal supaya struktur LTC tetap aman.
