# LTC Editor Football Manager 2021 Mobile V33

Browser-based LTC editor with Google Translate experimental support, local change snapshots, LTC reference comparison, and a paginated audit panel for suspected translation deviations.

## Audit against English LTC
1. Open the translated LTC file.
2. Load the English LTC using **Muat LTC referensi**.
3. Open **Audit terjemahan menyimpang** and press **Pindai perbandingan**.
4. Choose a filter and page size (10/20/50/100).
5. Use **Terjemahkan halaman ini dengan Google** to retranslate only the current audit page based on English source strings and apply results to matching IDs.

The audit is heuristic. It flags likely issues such as changed/missing placeholders, untranslated English, suspicious glossary artifacts, repeated words, and known context patterns. It cannot reliably judge every semantic translation error, so review results before saving. Google endpoints are unofficial and may be rate-limited. Failed strings are left unchanged.

## Notes
- Reference matching uses LTC string IDs.
- The V11 LTC save/rebuild engine is retained.
- Test the saved file in Football Manager 2021 before relying on it.


V33: Menambahkan filter utama untuk string yang diduga belum diterjemahkan. Panel perbandingan LTC dan audit kini berada dalam dropdown agar tidak mengganggu saat tidak digunakan. Navigasi pagination utama tersedia di atas dan bawah, termasuk lompat ke halaman tertentu. Deteksi string belum diterjemahkan menggunakan perbandingan LTC referensi jika tersedia, atau heuristik sederhana jika tidak.


## V34 — Penggantian massal berdasarkan posisi

Menu **Alat massal untuk semua string** kini memiliki pilihan posisi penggantian:
- **Di mana saja**: mengganti semua kemunculan kata/frasa utuh di dalam string (perilaku sebelumnya).
- **Hanya awal string**: mengganti kata/frasa utuh yang dimulai di awal string; spasi awal dipertahankan.
- **Hanya akhir string**: mengganti kata/frasa utuh yang berada di akhir string; spasi dan tanda baca akhir dipertahankan.

Pencocokan tidak membedakan huruf besar/kecil, tetapi teks pengganti digunakan persis seperti yang diketik. Contoh: `Loan player` → `Pemain pinjaman` pada posisi awal tidak akan mengubah `loan player` yang berada di tengah kalimat.
