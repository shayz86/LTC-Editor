# LTC Editor Football Manager 2021 — Mobile v30

Browser editor for Football Manager 2021 `.ltc` language files.

## Google-first recovery
- Google Translate experimental/unofficial remains the primary translator.
- MarianMT fallback remains OFF by default and is optional.
- When Google alters placeholder masks, the app retries with alternate mask token patterns. If that still fails, it translates text segments around placeholders separately, so original LTC placeholders are never sent to Google in that recovery strategy.
- Existing network retry/backoff and alternate Google endpoints remain enabled.
- Long text is split while preserving paragraph/newline separators.
- If all Google recovery strategies fail, the original string is preserved and the queue continues; failure counts and last error are shown. It does not silently replace the result with MarianMT.
- Google endpoints are unofficial and may rate-limit or become unavailable; no retry strategy can guarantee service availability.

## Existing capabilities
- LTC index and save/rebuild engine retained from earlier versions.
- Search, pagination, bulk tools, non-string text panel, pronoun placeholder handling, and paragraph-preserving translation features retained from v29.

## Recommended use
Start with a small test batch. Keep the original `.ltc` as backup. Review failure count and validate the result in Football Manager 2021.
