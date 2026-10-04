# LTC Editor FM2011 Mobile v12 — AI Translate

Browser-based Football Manager 2011 LTC editor optimized for Android/mobile.

## Core LTC features
- Reads the supplied FM2011 LTC structure: 52-byte header, variable records, record count, 9-byte index entries, 4-byte footer.
- Keeps original IDs, flags, record markers, and non-indexed gaps.
- Allows edited UTF-8 strings to become longer or shorter.
- Rebuilds physical offsets and the LTC index accordingly.
- Validates the rebuilt file and performs a round-trip parse before download.

## AI translation
v12 adds optional English → Indonesian translation using the Gemini API directly from the browser.

- Enter your own Gemini API key in the AI settings.
- Default model: `gemini-3.8-flash`.
- Translation runs in small batches so the 178,700-string file does not need to be rendered in the DOM.
- Placeholder-like tokens such as `[%date#1]`, `%club#1-short`, and `{...}` are protected and restored exactly.
- Proper names, club names, competition names, abbreviations, codes, and technical identifiers are instructed to remain unchanged unless clearly ordinary English words.
- Manually edited strings are skipped by the automatic translator.
- Translation is stored as normal LTC edits; use **Simpan / Download** after the translation pass.
- **Mulai otomatis setelah LTC dibuka** can be enabled. If enabled and a key is saved, translation starts in the background after indexing.
- Translation uses network/API requests and may consume Gemini quota. 178,700 strings is a large translation job and can take a long time.

## Security
The API key is stored in the browser's localStorage for convenience. A static GitHub Pages site cannot keep a client-side API key secret. Use a key intended for this local tool, restrict it where possible, and remove it from the app settings when finished.

## Deploy
Upload the project contents to GitHub Pages. No server is required for the LTC editor itself; AI translation requires browser access to the Gemini API.
