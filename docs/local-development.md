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

## Phase A architect iteration workflow

Start the local frontend (and optional disposable backend) with:

```text
npm run dev:all
```

Open `http://localhost:5173/?directorDebug=1` in a development build. The
Explore Home bar is explicitly marked development-only and provides:

- Launch Director — opens the eight-beat presentation. Use Play/Pause,
  Previous/Next, Restart, or the **Select implemented beat** menu to jump to
  any beat. The same controls are available with keyboard: Left/Right arrows,
  Space, and Escape.
- Start onboarding — opens the Phase A semantic onboarding workspace.
- Restart onboarding — rebuilds that workspace at deterministic seed `7101`
  and clears its session events.
- Enter Episode 1 directly — bypasses Director/onboarding and opens the existing
  Episode 1 contract, also at seed `7101`.

The Director CTA and Skip intro buttons open onboarding, not Episode 1. In the
onboarding workspace, use the existing World tools or invitation buttons to
change Noise/sample size, resample, fit, duplicate, and compare. Learner
actions emit normal Semantic Event v2 records. Prompts, beat navigation, debug
shortcuts, and view changes emit none. After any meaningful learner action,
choose **Explore this question** to promote a clean Episode 1 runtime.
Promotion is idempotent; selecting it again does not create another runtime.

Useful direct URLs:

```text
http://localhost:5173/?directorDebug=1   # Director + architect shortcuts
http://localhost:5173/                  # normal learner Explore Home
```

Close the playground to return safely. Restart onboarding whenever a clean
free-exploration state is needed; use direct Episode 1 entry when testing the
contract independently. These controls are development-only and are not part
of the production learner surface.

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

Episode 0 is frontend-shipped and runs through the same Explore host. Use
`npm run check:episode-0` to verify its registry, stage derivation, fallback,
out-of-order progress, and generic-runtime reuse fixture.

## Future extraction

The disposable `dev/backend/server.py` should be replaced by the private
`VOLK-Cloud` service when that repository exists. The frontend should keep
using `src/services/volkCloud/` rather than adding provider-specific requests
to UI components or the deterministic learning runtime.
