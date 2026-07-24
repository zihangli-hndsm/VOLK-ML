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
- Treat `src/core/components.js` as the canonical component registry. Every manifest declares a semantic operation, typed ports, property schema, framework compatibility, and minimum execution tier.
- Keep graph storage framework-neutral. `src/core/compiler.js` converts the graph to versioned VOLK IR before a PyTorch or TensorFlow backend generates source code.
- Mark conversion quality explicitly as `exact`, `adapted`, `approximate`, or `unsupported`; never silently change framework semantics.
- Define reusable structures as composite subgraphs of registered basic components. A composite must provide internal edges plus external input/output mappings and remain expandable on the canvas.
- Keep browser execution separate from source compilation. Components without a browser backend can still be designed and exported, while `src/core/runtimeTiers.js` recommends Browser CPU, Browser WebGPU, Local Python, or Remote GPU from estimated workload.
- Validate registry IDs, localized metadata, port mappings, composite references, both compiler backends, and execution-tier estimates before publishing component changes.
