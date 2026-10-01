# LTC Editor FM2011 — Mobile v3

Editor web ringan untuk file `.ltc` Football Manager 2011.

## Perubahan v3
- Metadata string disimpan dalam array angka ringkas, bukan 178 ribu objek JavaScript.
- Pembuatan indeks dilakukan bertahap agar browser Android tidak freeze.
- Pencarian dilakukan bertahap dan hasil dibatasi 12 item agar scrolling tetap ringan.
- Tidak menjalankan pencarian ulang setiap kali memilih string.
- Kalimat lengkap tetap tersedia di editor utama; placeholder seperti `[%club#1-short]` dipertahankan dan dipantau.
- Hasil pencarian dapat digulir sendiri tanpa membuat seluruh halaman memiliki ribuan node.
- File diproses lokal di browser.

## Deploy
Upload isi folder ini ke GitHub, lalu gunakan GitHub Pages atau Cloudflare Pages.
