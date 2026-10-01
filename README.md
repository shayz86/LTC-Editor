# LTC Editor — Football Manager 2011 · Mobile Optimized

Editor `.ltc` berbasis browser yang dioptimalkan untuk Android/HP dan file FM2011 sekitar 21,7 MB.

## Optimasi utama

- Tidak menyimpan 178 ribu teks string sebagai objek JavaScript.
- Saat file dibuka, aplikasi membuat **indeks ringan** berisi offset + panjang byte.
- Kalimat asli baru di-decode ketika diperlukan.
- Pencarian memakai debounce dan hanya merender maksimal 120 hasil.
- Daftar hasil menampilkan **kalimat lengkap**, bukan potongan/ellipsis.
- Saat string dipilih, teks lengkap dengan placeholder seperti `[%club#1-short]` dapat diedit langsung.
- Perubahan hanya disimpan di string yang benar-benar diedit.
- Jika tidak ada perubahan, file asli di-download tanpa rebuild.
- Export memperbarui length record hanya untuk string yang diubah.
- Placeholder yang hilang/bertambah diberi peringatan.
- Semua pemrosesan tetap lokal di perangkat.

## Struktur LTC yang digunakan

Berdasarkan file FM2011 yang diuji:

`0x01 + uint32 little-endian byteLength + UTF-8 text`

Byte di luar record yang dikenali dipertahankan.

## Deployment

Static site, tanpa build command. Bisa di-host di GitHub Pages atau Cloudflare Pages.

Untuk Cloudflare Pages: framework **None**, build command kosong, output directory `/`.

## Catatan

Format `.ltc` bersifat proprietary. Parser ini dibuat berdasarkan struktur file FM2011 yang dianalisis. Selalu backup file asli dan uji hasil export di game.
