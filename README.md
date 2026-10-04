# LTC Editor FM2011 Mobile v14 — Offline AI Translate

Browser-based editor for Football Manager Touch 2011 `.ltc` language files.

## What changed in v14
- Replaces unreliable public LibreTranslate servers with **local browser inference** using Hugging Face Transformers.js + `Xenova/opus-mt-en-id` (MarianMT English → Indonesian).
- No Gemini API key and no translation server/API quota.
- Model is downloaded once and reused from the browser cache when supported.
- WebGPU is used when selected/available; CPU/WASM fallback is available.
- Quantized model modes: q4 for WebGPU and q8 for CPU/WASM.
- Batch translation, duplicate-string deduplication, IndexedDB translation cache, pause/resume.
- Protects LTC `[%...]` placeholders and line breaks during translation.
- **The validated v11 LTC save/rebuild engine is retained.** IDs/order stay unchanged; physical offsets are rebuilt when byte lengths change.

## Important
The first model load requires an internet connection to Hugging Face/CDN. After the model and browser cache are available, translation inference itself runs locally in the browser. The MarianMT model is around the hundreds-of-MB scale, so the first load can be large; quantized variants reduce the download substantially.

The tool does not guarantee that every machine-translated Football Manager sentence is stylistically perfect. Review/polish the Indonesian result before saving.

Model reference: `Xenova/opus-mt-en-id`.
