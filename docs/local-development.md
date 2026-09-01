# Local development

VOLK-ML is local-first. The frontend and local learning runtime work without a
backend; the temporary backend only verifies the future Cloud boundary.

## Start

```text
npm install
copy .env.example .env.local
npm run dev:all
```

Open `http://localhost:5173`. The local backend listens at
`http://127.0.0.1:8000`, and its health contract is
`http://127.0.0.1:8000/health`.

On Windows, `npm run dev:backend` uses the Python launcher (`py -3`). If the
launcher is not available, run `python dev/backend/server.py` directly. The
frontend-only command is `npm run dev`.

## Configuration

`VITE_VOLK_API_URL` is optional. It defaults to
`http://127.0.0.1:8000`; set it in `.env.local` when testing another
development backend. Do not put API keys or provider secrets in this file.

The development-only header indicator reports either “Cloud development
backend connected” or “Local mode — backend unavailable”. An unavailable
backend does not block Explore, World manipulation, Experiment operations, or
deterministic local Evidence.

## Tests

```text
npm run check:volk-cloud
npm run test:local
npm run build
git diff --check
```

`npm run test:local` runs the Cloud boundary checks followed by the complete
existing client checks. No production backend is bundled into GitHub Pages.

## Future extraction

The disposable `dev/backend/server.py` should be replaced by the private
`VOLK-Cloud` service when that repository exists. The frontend should keep
using `src/services/volkCloud/` rather than adding provider-specific requests
to UI components or the deterministic learning runtime.
