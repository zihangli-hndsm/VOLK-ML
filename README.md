# VOLK-ML

VOLK-ML (Vivid Online Learning Kit for Machine Learning) is a bilingual visual ML lab that connects intuition, model architecture, and runnable code.

[Open the browser demo](https://zihangli-hndsm.github.io/VOLK-ML/)

## What works today

- Build typed machine-learning graphs on a desktop, tablet, or phone, in English, Chinese, or parallel bilingual mode.
- Learn every registered operation through intuition, principles, localized formulas, examples, and a semantic visual. Canvas glyphs stay static; the guide can play the corresponding animation.
- Use the linear-regression playground to drag weight and bias, inspect sampled data points, and see the fitted line and MSE change together.
- Run complete linear-regression and K-nearest-neighbor classification pipelines locally in the browser.
- Import CSV or JSON data without uploading it to a server.
- Define neural architectures as `Tensor Input → layers → Model Output`, then connect a **Supervised Trainer** to a `DatasetSplit`, `ModelSpec`, `LossSpec`, and `OptimizerSpec` to export a complete single-input/single-output tabular training loop for PyTorch or TensorFlow/Keras.
- Write a safe Custom Loss with the small tensor-expression DSL: `prediction`, `target`, arithmetic, and `mean`, `sum`, `abs`, `square`, `sqrt`, `log`, `exp`, and `clip`. Expressions are parsed rather than inserted as source code, must depend on `prediction`, and are reduced to a scalar before training.
- Create, save, delete, expand, and collapse copy-style custom composite components. Built-in MLP, convolution, and residual blocks remain expandable too.
- Switch to an automatic architecture view without changing the free-form canvas layout.
- Name projects, recover local IndexedDB auto-saves, download a versioned `.volkml.json` snapshot, and re-open project files locally.
- Ask the deterministic project explainer for a graph walkthrough; optionally provide a compatible chat-completion endpoint for follow-up questions without persisting an API key.
- Estimate whether a graph belongs on Browser CPU, Browser WebGPU, Local Python, or Remote GPU without claiming unavailable runtimes.
- Let an in-page agent inspect and edit the mounted canvas, run supported browser pipelines, export code, and download the canonical project file through a versioned API.

## Training and execution boundaries

The browser runner intentionally implements only small L0 regression and KNN pipelines. A Supervised Trainer is an L2 **source-export** feature: it does not train in the public browser app.

For Trainer export, the model input must come from the connected `Model Output`, not a browser-only model such as Linear Regression. The first release supports one Tensor Input and one Model Output, with `float32` and `float16` inputs; `int32` Trainer inputs are rejected rather than silently coerced. TensorFlow exports use a deterministic shuffled split while retaining array structure; PyTorch exports use a seeded split.

KNN is intentionally browser-only. Browser WebGPU, local Python orchestration, remote GPU execution, cloud storage, and collaboration are not implemented in the public application.

## Project lifecycle and future cloud services

Local-first use is the default: IndexedDB protects the active project, downloads create portable JSON snapshots, and supported browsers may keep working with an authorized local file. The project format contains no cloud credentials or API keys.

Future cloud save, collaboration, and remote compute integrate only through the versioned service boundary in [`src/platform/services.js`](src/platform/services.js). This keeps the open editor usable offline while allowing a hosted edition to implement the same project APIs separately.

## Canvas Agent API

After the editor mounts, trusted same-page code can open its canvas instance through `window.__VOLK_ML_AGENT__`:

```js
const canvas = await window.__VOLK_ML_AGENT__.open();

const state = canvas.getState();
const components = canvas.listComponents();

const { nodeId } = await canvas.addNode({
  componentId: 'dense_node',
  position: { x: 640, y: 180 },
  parameters: { input_features: 32, units: 64 },
});

await canvas.updateNode(nodeId, { parameters: { units: 128 } });
await canvas.run(); // L0 browser pipelines only
await canvas.exportCode('pytorch', { download: true });
await canvas.downloadProject();
```

The API also supports typed connections, deletion, selection, project renaming, dataset replacement, project loading, state subscriptions, and direct project snapshots. It is deliberately an in-page JavaScript capability rather than an unauthenticated network endpoint. See [`docs/architecture/agent-canvas-api.md`](docs/architecture/agent-canvas-api.md) for the complete v1 contract and security boundary.

## Run locally

```bash
npm ci
npm run dev
```

Then open <http://localhost:5173>.

## Validate

```bash
npm run check
npm run build
```

The core check verifies every component has a usable browser or compiler path, generates and parses representative PyTorch and TensorFlow Python for every architecture operation, executes both browser pipelines, and validates localization, visual semantics, composites, project migrations, Trainer and Custom Loss safety, execution tiers, and the hosted-service boundary.

## Architecture

The active implementation uses:

- `src/core/components.js` for the versioned component registry;
- `src/core/compiler.js` for VOLK IR and source generation;
- `src/core/browserRuntime.js` for typed L0 browser execution;
- `src/core/visualLanguage.js` and `src/components/VisualGlyph.jsx` for static canvas glyphs and guide animation geometry;
- `src/core/tutorials.js` for bilingual component lessons;
- `src/core/customComposites.js` for user-defined nested components;
- `src/core/localProjects.js` and `src/core/project.js` for auto-save, project files, and migration;
- `src/core/explanation.js` for deterministic project explanation and optional model hand-off;
- `src/core/canvasAgent.js` for the versioned in-page canvas inspection and command contract;
- `src/platform/services.js` for local defaults and future hosted-service adapters;
- `src/main.jsx` for the visual editor and learning interface.

Start with [`docs/architecture/overview.md`](docs/architecture/overview.md). The canvas command contract is documented in [`docs/architecture/agent-canvas-api.md`](docs/architecture/agent-canvas-api.md), and the cloud boundary in [`docs/architecture/platform-services.md`](docs/architecture/platform-services.md).

## Development workflow

Contributions follow **Design -> Development -> Acceptance -> Pull request**. Agree on the goal, scope, approach, acceptance criteria, and test plan before implementation; open a pull request only after the agreed checks pass and the acceptance evidence has been reported. VOLK-ML does not use a Codex automated review-submit loop.

See [`docs/development-workflow.md`](docs/development-workflow.md) for the stage gates and required acceptance report, and [`AGENTS.md`](AGENTS.md) for repository-specific implementation standards.

## Build

```bash
npm run build
```

The static GitHub Pages-ready output is written to `dist/`.
