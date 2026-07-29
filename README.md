# VOLK-ML

VOLK-ML (Vivid Online Learning Kit for Machine Learning) is a bilingual visual ML lab that connects intuition, model architecture, and runnable code.

[Open the browser demo](https://zihangli-hndsm.github.io/VOLK-ML/)

## What works today

- Build typed machine-learning graphs on a desktop, tablet, or phone.
- Learn all 39 registered operations through English/Chinese intuition, principles, formulas, examples, and simplified visuals.
- Run complete linear-regression and K-nearest-neighbor classification pipelines locally in the browser.
- Import CSV or JSON data without uploading it to a server.
- Generate PyTorch and TensorFlow/Keras source for supported neural architectures.
- Expand reusable MLP, convolution, and residual blocks into basic components.
- Export and restore versioned VOLK-ML project JSON.
- Estimate whether a graph belongs on Browser CPU, Browser WebGPU, Local Python, or Remote GPU without claiming unavailable runtimes.

KNN is intentionally browser-only. Browser WebGPU, local Python orchestration, remote GPU execution, cloud storage, and collaboration are not implemented in the public application.

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

The core check verifies every component has a usable browser or compiler path, generates and parses representative PyTorch and TensorFlow Python for every architecture operation, executes both browser pipelines, and validates localization, composites, execution tiers, and the hosted-service boundary.

## Architecture

The active implementation uses:

- `src/core/components.js` for the versioned component registry;
- `src/core/compiler.js` for VOLK IR and source generation;
- `src/core/browserRuntime.js` for typed L0 browser execution;
- `src/core/tutorials.js` for bilingual component lessons;
- `src/platform/services.js` for local defaults and future hosted-service adapters;
- `src/main.jsx` for the visual editor and learning interface.

Start with [`docs/architecture/overview.md`](docs/architecture/overview.md). The cloud boundary is documented in [`docs/architecture/platform-services.md`](docs/architecture/platform-services.md).

## Build

```bash
npm run build
```

The static GitHub Pages-ready output is written to `dist/`.
