# LTC Editor FM2011 — Mobile v4

Editor `.ltc` Football Manager 2011 yang dioptimalkan untuk browser Android.

## Fokus v4
- Pagination 10 / 20 / 50 string per halaman (default 20).
- Hanya halaman aktif yang dibuat menjadi DOM; tidak menampilkan 178 ribu string sekaligus.
- Jump ke halaman tertentu.
- Kalimat lengkap tetap ditampilkan saat string dipilih.
- Placeholder `[%...]` dipertahankan/diperingatkan jika hilang atau berubah.
- Jika panjang string berubah, **offset string berikutnya dihitung ulang secara dinamis** berdasarkan akumulasi perubahan byte dari string-string sebelumnya.
- Saat export, header length record ditulis ulang sesuai panjang UTF-8 terbaru.
- Byte yang tidak diedit dipertahankan dari file asli.

## Logika offset
Jika string #100 bertambah 20 byte, maka offset efektif string #101 dan semua string setelahnya bergeser +20 byte. Jika string #150 kemudian berkurang 5 byte, string #151 dan setelahnya akan menjadi +15 byte dari posisi awal. Perubahan hanya memengaruhi posisi record setelah titik perubahan; string sebelum perubahan tetap pada offset awal.

## Deployment
Upload isi folder ini ke GitHub Pages atau Cloudflare Pages sebagai static site. Tidak ada server upload: file `.ltc` diproses lokal di browser.
