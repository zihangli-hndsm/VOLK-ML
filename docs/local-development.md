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

On Windows, `npm run dev:backend` tries the Python launcher (`py -3`) and falls
back to `python` only when the launcher executable is unavailable. If Python
itself exits with an error, it is reported rather than retried with another
interpreter. The frontend-only command is `npm run dev`.

## Configuration

`VITE_VOLK_API_URL` is optional. In development it defaults to
`http://127.0.0.1:8000`; set it in `.env.local` when testing another
development backend. In a production build, an absent URL disables Cloud
integration and no network request is attempted. Set the variable at build
time only when the published application should check a configured endpoint.
Do not put API keys or provider secrets in this file.

The development-only header indicator reports either “Cloud development
backend connected” or “Local mode — backend unavailable”. An unavailable
backend does not block Explore, World manipulation, Experiment operations, or
deterministic local Evidence.

## Tests

```text
npm run check:volk-cloud
npm run check:local-backend
npm run test:local
npm run build
git diff --check
```

`npm run check:volk-cloud` covers mocked Cloud-client behavior, production
no-config network isolation, development defaults, configured production
endpoints, and runtime independence. `npm run check:local-backend` starts the
actual disposable Python fixture on a temporary port and verifies its `/health`
and local CORS contract, including cleanup. `npm run test:local` runs both
focused checks. The comprehensive `npm run check` remains the repository-wide
suite. No production backend is bundled into GitHub Pages.

## Future extraction

The disposable `dev/backend/server.py` should be replaced by the private
`VOLK-Cloud` service when that repository exists. The frontend should keep
using `src/services/volkCloud/` rather than adding provider-specific requests
to UI components or the deterministic learning runtime.
