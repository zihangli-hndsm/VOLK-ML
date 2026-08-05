# VOLK-ML development standards

## Read only what the task needs

- Treat code as the final source of truth and keep the matching architecture document current whenever a contract changes.
- Read `docs/architecture/overview.md` for cross-cutting changes or when the affected subsystem is unclear.
- Read `docs/architecture/component-manifest.md` before adding or changing components, ports, properties, compatibility metadata, or composites.
- Read `docs/architecture/compiler-ir.md` before changing VOLK IR, graph selection, generated PyTorch/TensorFlow code, loss semantics, or conversion behavior.
- Read `docs/architecture/execution-tiers.md` before changing browser execution, workload estimates, tier thresholds, or backend availability.
- Read `docs/architecture/platform-services.md` before changing account, project storage, collaboration, hosted compute, or cloud-service injection boundaries.
- Do not scan unrelated legacy TypeScript files. The active application entry point is `src/main.jsx`.

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
- Treat tutorial formulas as visible UI metadata. Store every formula as a localized object, localize any prose inside it, and render it through `t(...)`; language-neutral mathematical notation may share the same value across languages.
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
- Keep hosted-service integrations behind `src/platform/services.js`. Do not add billing-provider checks, credentials, or server authorization logic to the open editor.
- Validate registry IDs, localized metadata, port mappings, composite references, both compiler backends, and execution-tier estimates before publishing component changes.

## Visual language and lessons

- Canvas glyphs are lightweight, static semantic cues. Do not add SVG animation to the canvas; animation belongs in the explicit component guide/playground only.
- A visual must teach the component's actual default semantics. In particular, represent axes, shapes, extrema, and function origins correctly rather than using generic decorative motion.
- Keep visual geometry in `src/core/visualLanguage.js` when it is shared by rendering and tests. Derive SVG paths, animation paths, and checked endpoints from shared coordinates; do not make a regression assertion compare independently hard-coded values.
- Keep stage color stable: data = green, model = blue, training = orange, output = violet. Use separate status affordances for execution state.
- Any new or changed component visual needs a focused invariant in `scripts/check-core.mjs` when a mathematical or semantic claim can regress.

## Supervised Trainer and Custom Loss

- `Tensor Input → architecture → Model Output` is a symbolic model definition. `DatasetSplit` must bind to `Supervised Trainer`, never directly to Tensor Input.
- A connected Trainer is an L2 source-export root. It requires exactly one reachable Tensor Input and Model Output plus typed DatasetSplit, LossSpec, and OptimizerSpec inputs. Validate that contract before choosing an architecture or legacy tabular backend; never silently fall back for an invalid Trainer graph.
- Do not route browser-only `ModelSpec` producers, such as Linear Regression, into Trainer export. The Trainer model source must be the selected `model_output`.
- Preserve declared Trainer input dtype across generated frameworks. The current generic tabular Trainer supports `float32` and `float16`; reject unsupported types with a localized error instead of coercing them.
- Custom Loss is a deliberately small expression DSL, not a Python or JavaScript escape hatch. Keep its whitelist framework-neutral, parse before emitting source, require a dependency on `prediction`, and ensure the generated objective is scalar before `backward()` or metric recording.
- When split semantics change, keep browser, PyTorch, and TensorFlow behavior explicitly documented and add source-level regression assertions. Array-oriented TensorFlow exports must retain array/tensor structure rather than converting feature matrices to Python multi-input lists.

## Projects, composites, and hosted boundaries

- Project JSON is a portable, framework-neutral user artifact. When changing persisted fields, increment `PROJECT_VERSION` as appropriate, add an import migration, and preserve old graph handles or migrate them explicitly.
- Keep project names, local auto-save, file download, and local-file persistence behind `src/core/localProjects.js` / `src/core/project.js`; do not fold persistence policy into canvas components.
- Custom composites are copy-style definitions. Boundary ports include unsatisfied internal child ports even when the selected subgraph has no surrounding edges. Deleting a catalog definition must not mutate existing instances.
- Cloud save, collaboration, model APIs, and remote compute use `src/platform/services.js`. Never store API keys in project JSON, component parameters, local project history, or public client configuration.

## Canvas Agent API

- `src/core/canvasAgent.js` is the versioned, framework-neutral command contract for agents that operate a mounted editor. Keep graph mutations in its pure helpers so UI actions and agent actions obey the same component, port, single-input, and cycle rules.
- The browser entry point is `globalThis.__VOLK_ML_AGENT__`. It is an in-page capability, not an HTTP server, authentication boundary, or hosted-service adapter. A host that exposes it to an external agent is responsible for origin isolation, user consent, and authorization.
- Return serializable snapshots rather than React state, DOM nodes, file handles, API keys, or mutable registry objects. Commands that mutate state are asynchronous; `getState()` must reflect an accepted mutation before its promise resolves.
- Preserve the distinction between execution and export. `run()` may execute only graphs supported by the L0 browser runtime; L1-L3 graphs remain inspectable and exportable.
- Project downloads must use the canonical versioned project serializer. Do not invent an agent-only project format or bypass import migration and manifest resolution.
- Changing a required method, command payload, snapshot field meaning, or error-code meaning requires incrementing `CANVAS_AGENT_API_VERSION`, updating `docs/architecture/agent-canvas-api.md`, and adding a focused contract assertion.

## Required validation

- Run `npm run check` for component, compiler, composite, localization, and tier invariants.
- Run `npm run build` for every application or documentation change that also touches executable code.
- Run `git diff --check` before publishing.
- Add a focused regression assertion to `scripts/check-core.mjs` when changing a manifest contract, compiler semantic, graph-selection rule, persisted project contract, visual invariant, or tier boundary.

## Development workflow

- Follow [`docs/development-workflow.md`](docs/development-workflow.md) for every change. The required order is Design -> Development -> Acceptance -> Pull request.
- Before editing executable code, agree with the user on the goal, scope, implementation approach, acceptance criteria, and exact test plan. Do not begin Development until the user accepts that design.
- If implementation exposes a material design gap or requires a scope or behavior change, return to Design and get agreement before continuing.
- After implementation, run the agreed task-specific tests plus the applicable baseline validation above. Report criterion-by-criterion evidence, skipped checks, limitations, and deviations.
- Do not open a pull request until Acceptance passes. A development branch is allowed before then, but it must not be treated as accepted or ready for review.
- Do not run a Codex automated review-submit loop and do not repeatedly post `@codex review`. Automated review and CI feedback do not replace the agreed acceptance plan.
- Feedback received after opening a pull request is a new validation signal. Classify it against the accepted design; material changes return to Design, while in-scope fixes pass through Development and Acceptance before the branch is updated.

## Changelog

- Every accepted change set is recorded in `CHANGELOG.md` before a pull request is opened, so the pull request always contains the entry for its own changes.
- Entries are append-only. Never edit, rewrite, reorder, or delete an existing entry. If an earlier entry needs a correction, add a new entry that states the correction instead of changing the old one.
- One entry per accepted change set (one development cycle / one pull request), headed by the ISO date, containing:
  - the goal and what changed (user-visible behavior first);
  - the affected areas or files;
  - the validation and acceptance evidence;
  - known limitations or follow-ups, if any.
- Record the entry immediately after Acceptance passes. A cycle is not ready for a pull request until its changelog entry exists.
