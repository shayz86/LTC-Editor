# LTC Editor FM2011 — Mobile v11 — Dynamic Index

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


## FM2011 Safe Rebuild v10

Versi ini menggunakan struktur LTC FM2011 yang terdeteksi pada `english.ltc`: 52-byte header, 178.700 indexed records, 4-byte record count, lalu index 9-byte per record dan footer 4-byte. Saat panjang string berubah, editor membangun ulang record secara berurutan dan memperbarui field offset pada seluruh index setelah perubahan.

Sebelum download, file hasil divalidasi ulang: jumlah record, panjang setiap record, jumlah index, ID index, flags, offset efektif, dan footer harus konsisten. File tanpa perubahan direbuild byte-for-byte identik dengan file asli. Setelah export, V10 juga membuka kembali hasil menggunakan parser yang sama dan membandingkan seluruh ID, flag, panjang, dan isi 178.700 string sebelum file di-download.

**Penting:** jangan gunakan versi lama untuk menguji edit dengan perubahan panjang byte. Gunakan v7 dan simpan backup `english.ltc` asli.


## V11 fix
- Fixes the Android/Chrome save error `First argument to DataView constructor must be an ArrayBuffer`.
- The LTC parser now accepts both `ArrayBuffer` and `Uint8Array`, including the generated buffer used by round-trip validation.
- Dynamic-length records and index rebuilding remain unchanged from V10.
