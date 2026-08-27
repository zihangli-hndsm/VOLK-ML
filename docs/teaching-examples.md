# Teaching examples

VOLK-ML examples are more than "pipelines that run". Each one has a teaching role, a deterministic dataset, and a machine-verifiable teaching contract so that what the learner sees matches what the model can actually do.

## Roles

- **Concept** — one or two visual features, a clear data rule, browser-runnable, and a simple baseline to compare against. Used by playgrounds and first-stage teaching videos.
- **Applied** — more features, interactions, noise, and overlapping classes; shows the input breadth of a real problem. May run in the browser or export source.
- **Architecture Sketch** — the runtime or data format does not support full training yet, but the architecture is worth showing. The UI always labels it and states the limitation; it never claims to train in the public browser app.

## Data generation rules

- All data lives in `src/core/teachingDatasets.js`, generated from explicit seeds with a project PRNG (`createSeededRandom` / `randomNormal`). No `Math.random()`.
- The same seed and code produce identical files on every run; example JSON uses a fixed `savedAt`.
- Feature generation always completes before labels are sampled. Applied datasets with interactions declare `labelSampling: 'probability'` and `featuresGeneratedBeforeLabels: true`; the generator rejects definitions that could mutate features after labels.
- Feature columns and the target column are always disjoint.
- Concept datasets should encode the smallest meaningful geometry for their
  lesson. The canonical MLP XOR concept is balanced, deterministic, has all
  four quadrants populated, uses a rule-derived label with no flips, and
  keeps enough rows to expose the pattern without turning the first lesson
  into a noise-smoothing exercise. Label-noise robustness is a separate
  explicitly named source.
- Each example dataset has a unique `id` referenced by its example metadata;
  source aliases are not used to create competing teaching meanings.

## Teaching contract

Metadata in `src/core/exampleProjects.js` declares what each example must satisfy:

```js
teachingContract: {
  minRows: 200,
  maxRows: 500,
  minFeatures: 8,
  classBalance: { min: 0.35, max: 0.65 },
  maxSingleFeatureThresholdAccuracy: 0.86,
  maxLinearSeparatorAccuracy: 0.82,
  expectedBrowserResult: { metric: 'accuracy', min: 0.8 },
  requiredNonlinearity: true,
  linearBaselineGap: 0.12,
  residualNonZero: true,
}
```

`src/core/exampleQuality.js` implements the pure checks: class distribution, best single-feature threshold accuracy, best 2-D linear separator accuracy, R², input-shape matching, post-label-mutation metadata, and required nonlinearity between dense layers. The generator runs every check, reports the example/field/actual/expected on failure, and exits non-zero.

## Why "runs" is not enough

A model can run and still teach the wrong lesson:

- A spam classifier solved by one feature teaches nothing about interactions.
- An "image" example fed 28×28 grayscale values must not call itself cat-vs-dog.
- Two adjacent dense layers with no activation are still a linear model.
- Labels derived from features (then features edited from labels) leak the answer.

The contracts above exist to catch these cases automatically in `npm run check`.

## Adding an example

1. Add a deterministic dataset to `src/core/teachingDatasets.js`.
2. Add metadata (role, concept, datasetId, teachingContract, limitationsKey for sketches) to `src/core/exampleProjects.js`.
3. Add a definition (dataset + nodes/edges) in `scripts/generate-examples.mjs`.
4. Run `npm run generate:examples`; tune data or model until all contracts pass.
5. Add localized title/description/limitation keys in `src/locales/ui.js`.
6. Update `examples/README.md` and this document.
