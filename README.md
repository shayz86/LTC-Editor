# LTC Editor Football Manager 2021 — Mobile v17

Browser-based editor for Football Manager 2021 `.ltc` language files.

## v16 — M2M-100 / NLLB + Football Manager glossary
- Model: `Xenova/nllb-200-distilled-600M` via Transformers.js.
- English → Indonesian using `eng_Latn` → `ind_Latn`.
- Runs in the browser with WebGPU when available, with WASM fallback.
- Uses q4f16 on WebGPU and compact q8/quantized ONNX on WASM; first load still requires a large download.
- Optional translation quality: Fast (beam 1), Balanced (beam 2), High (beam 4).
- Full-sentence placeholder pass preserves grammatical context; if a marker is lost, it falls back to safe fragment translation.
- Exact `[%...]` LTC placeholders are restored byte-for-byte.
- Football Manager 2021 glossary fixes high-confidence terms such as `first leg` → `leg pertama`.
- Placeholder-aware grammar rules handle common `stadium`, `date`, and `time` variables (`di`, `pada`, `pukul`).
- IndexedDB cache, duplicate-string deduplication, pause/resume, page/1000/all modes.
- The validated v11 LTC save/rebuild engine is retained. IDs/order remain unchanged; physical offsets are rebuilt when translated byte lengths change.

## Important
The NLLB model is hosted on Hugging Face and downloaded on first use. Transformers.js then runs inference locally in the browser. WebGPU can accelerate inference where supported; WASM is the compatibility fallback. Hugging Face lists this model as a 196-language NLLB translation model with ONNX weights for Transformers.js and currently provides quantized ONNX variants.

The model is licensed CC-BY-NC-4.0; check that license if you plan to distribute the model or use the project commercially.

This tool is an unofficial editor/translation utility and is not affiliated with Sports Interactive or SEGA.


## V17 safety note
V16 used NLLB-200 distilled 600M as the automatic WebGPU model. Its quantized ONNX files are large enough to trigger memory pressure on Android Chrome during initialization. V17 defaults to M2M-100 418M over WASM and makes WebGPU opt-in. NLLB remains available as an experimental high-memory option.
