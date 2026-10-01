# LTC Editor — Football Manager 2011

Editor `.ltc` berbasis browser untuk file language Football Manager 2011.

## Fitur

- Buka file `.ltc` langsung dari perangkat.
- Pemrosesan file dilakukan lokal di browser; file tidak di-upload ke server.
- Mendeteksi record `0x01 + uint32 little-endian length + UTF-8 text`.
- Pencarian string cepat.
- Filter huruf besar/kecil.
- Filter string yang memiliki placeholder `[%...]`.
- Editor string.
- Peringatan jika placeholder hilang/bertambah.
- Mendukung perubahan panjang teks dengan memperbarui field length record.
- Undo praktis melalui "Batalkan perubahan" untuk kembali ke file asli.
- Download hasil sebagai `*_edited.ltc`.
- PWA dan siap Cloudflare Pages.

## Penting

Format `.ltc` bersifat proprietary. Parser ini dibuat berdasarkan struktur file FM2011 `english.ltc` yang dianalisis untuk project ini. Selalu simpan backup file asli dan uji hasil export di game sebelum mengganti file utama.

Parser sengaja mempertahankan byte di luar record string yang dikenali. Jika sebuah file memiliki varian struktur berbeda, aplikasi dapat melewatkan sebagian record.

## Jalankan lokal

Tidak perlu build system:

```bash
python3 -m http.server 8080
```

Buka:

`http://localhost:8080`

Atau deploy langsung folder ini ke Cloudflare Pages.

## GitHub + Cloudflare Pages

```bash
git init
git add .
git commit -m "Initial LTC Editor"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

Di Cloudflare Pages:
1. Create application / Pages.
2. Connect to Git.
3. Pilih repository.
4. Framework preset: None.
5. Build command: kosong.
6. Build output directory: `/`.
7. Deploy.

Setiap `git push` berikutnya dapat memicu deployment baru jika Git integration diaktifkan.

## Batasan saat ini

- Tidak mengubah game database, hanya language `.ltc`.
- Tidak mencoba menebak arti placeholder.
- ID yang ditampilkan adalah indeks record + offset byte, bukan klaim sebagai ID internal resmi game.
- Untuk keamanan, backup file asli sebelum pengujian.
