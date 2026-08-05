# Roadmap

VOLK-ML is a teaching-first visual ML lab. This page tracks the next tasks and the components or platforms not yet covered.

## Teaching examples

The bundled examples in [`examples/`](../examples/README.md) cover most registered components. Each targets a different ML task so a course can follow a natural arc:

| Task | Example | Status |
| --- | --- | --- |
| House price prediction | `house-price-regression.volkml.json` | ✅ runs in browser |
| Iris flower classification | `iris-knn-classification.volkml.json` | ✅ runs in browser (KNN, browser-only) |
| Spam detection | `spam-mlp-classification.volkml.json` | ✅ runs in browser |
| Energy demand forecasting | `energy-demand-mlp.volkml.json` | ✅ exports training loop |
| Diabetes risk prediction | `diabetes-risk-mlp.volkml.json` | ✅ exports training loop |
| Cat vs dog image classification | `cat-dog-cnn.volkml.json` | ✅ exports architecture; image data/training pending |
| Movie recommendation | `movie-recommendation.volkml.json` | ✅ exports architecture; training loop pending |
| Sentiment analysis | `sentiment-lstm.volkml.json` | ✅ exports architecture; sequence data pending |

## Planned example tasks

Not yet implemented in the platform; these belong to the next development cycles:

- **Similar image search (Vector Search)** — an embedding-index workflow over image features.
- **Chatbot (LLM)** — conversational models and prompt-driven generation.
- **AI Agent planning** — tool-use and multi-step planning pipelines.
- **Text generation / attention** — GRU, Multi-Head Attention, and Transformer-style examples.
- **Regression with MSE** — a trainer example using the plain MSE loss (the default loss in generated code).
- **BatchNorm1D** — normalization example for vector or sequence features.

## Platform infrastructure

- **Offline-first styling** — replace the Tailwind CDN with a build-time pipeline so the app and its recorded videos work without a network connection.
- **Browser WebGPU** — L1 execution for medium models on GPU-accelerated browsers.
- **Local Python orchestration** — run exported training loops locally from the UI.
- **Remote GPU execution** — hosted compute through the versioned service boundary.
- **Cloud storage and collaboration** — accounts, shared projects, and real-time co-editing via `src/platform/services.js`.
- **Shape inference** — derive tensor shapes from the graph instead of requiring explicit layer dimensions.
- **Image and sequence datasets** — import image folders and tokenized text so the CNN, LSTM, and embedding examples can actually train.
