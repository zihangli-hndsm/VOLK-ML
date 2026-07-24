# VOLK-ML development standards

## Localized UI is the default

- Put every user-visible interface string in the active resource file `src/locales/ui.js` and reference it with a stable semantic key such as `runner.execute`.
- `src/i18n.js` is the runtime resolver used by the active `src/main.jsx` entry point. Do not add a second translation context or wire new UI to the legacy TypeScript prototype.
- Do not add literal UI copy directly to JSX, alerts, notices, validation branches, accessibility labels, titles, placeholders, or browser execution errors.
- Dataset column names, user-provided file names, port identifiers, model type identifiers, generated source code, and persisted data are not UI copy and must not be translated.
- Use translation parameters for dynamic copy: `t('runner.predict', { target })`. Do not build translated sentences by concatenating fragments.
- Throw browser-facing validation failures with `localizedError(key, params)` and render them with `translateError(error, t)`.
- Keep English as the fallback for every key. Adding a language requires:
  1. adding it to `languages`;
  2. supplying that language for all keys in `messages`;
  3. verifying both single-language and parallel-language modes.
- Preserve the saved language preference in `localStorage`. Imported projects may update that preference only through the existing language settings API.
- Before publishing UI work, run `npm run build` and search changed components for newly hard-coded user-visible text.

## Component manifests

- Component names, descriptions, and property labels remain localized objects in the manifest because plugins own this metadata.
- Categories shown in the interface must be resolved through `category.*` keys.
- Keep internal IDs and port/type names stable across languages so project JSON and graph connections remain portable.
