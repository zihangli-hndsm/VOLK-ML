# R148 LUMI guidance acceptance record

This record is intentionally kept in VOLK-ML. It describes the local-first
validation performed for the bounded R148 repair; it does not change the Cloud
or Auth repositories.

## Reproduction

```text
npm run dev -- --host 127.0.0.1 --port 5174
http://127.0.0.1:5174/?directorDebug=1&r148=final

# For the mounted Ask/Teaching harness, restart Vite with the pilot flag:
$env:VITE_VOLK_TEACHING_DIALOGUE_PILOT='1'; npm run dev -- --host 127.0.0.1 --port 5174
http://127.0.0.1:5174/r148-lifecycle-harness.html
```

The browser run used the Codex in-app browser at desktop width (1280x720),
English locale, with no Cloud URL configured. The page exposed the development
shortcuts and the Episode 1 entry. The production Episode flow was exercised
through Skip prediction, Fit A, Sample same World, Fit B, and Compare A / B.
The rendered surface showed the structured CHANGED / HELD CONSTANT / OBSERVED
OUTCOME comparison, labelled A/B fitted lines, and the Sampling variability
Concept Card with continuation questions.

The mounted lifecycle harness is available at:

```text
http://127.0.0.1:5174/r148-lifecycle-harness.html
```

It mounts the real `LumiCompanion`, `AskVolkPanel`, and
`TeachingDialoguePanel` with delayed fixture adapters. The captured trace
covers Ask success/error/cancel, Teaching success/cancel, natural context-bubble
expiry, parent rerenders while requests are pending, Teaching Stop, reset,
context-switch cancellation followed by stale completion, concept feedback
consumption, target withdrawal, and child unmount cancellation. The production
panels intentionally suppress overlapping submissions; the executable flow
therefore validates the real context-switch/reset stale-request boundary rather
than claiming an artificial overlapping A/B request.

## Verified locally

- `npm run check:lumi-visible-guidance`
- `npm run check:lumi-mounted-lifecycle` (static wiring assertions only)
- `npm run check:lumi-embodied`
- `npm run check:episode-1`
- `npm run check:teaching-dialogue-pilot`
- `npm run test:teaching:integration`
- `npm run check`
- `npm run build`
- `git diff --check`

The focused host flow exercises entry, Fit A, duplicate/resample, stale-fit
invalidation, Fit B, Compare, deterministic Evidence, and the resulting
policy targets. Ordinary Ask/teaching lifecycle completion remains neutral;
only runtime concept feedback carrying a deterministic evidence identity can
illuminate.

The browser trace checkpoints were:

```text
Episode entry -> prediction skipped -> Fit A -> Sample same World
-> Fit B -> Compare A / B -> Evidence: evidenced
-> Concept Card: Sampling variability -> continuation candidates visible
Ask harness: start -> parent rerender -> success -> finish
Teaching harness: start -> parent rerender -> success -> finish
Natural bubble expiry -> parent rerender -> bubble remains absent
Teaching Stop -> cancel -> stale completion ignored
Reset -> ambient/no bubble -> stale completion ignored
Teaching context change -> cancel -> stale completion ignored
Ask rejection: error -> finish
Concept surface -> consume -> STAY_SILENT/ambient
Target withdrawal -> missing/ambient
Ask unmount: cancel
```

## Fixed browser evidence workflow

The complete local browser evidence run is reproducible with one command from
the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-r148-browser.ps1
```

The command starts a temporary Vite server and an isolated system Chrome via
the Chrome DevTools Protocol, runs with Cloud disabled, and shuts both down at
the end. It writes two short normal-motion WebM recordings, real UI PNG
checkpoints, and HTML slideshows under `docs/acceptance/assets/r148/`.
`episode-normal.webm` covers the real Episode flow; `lumi-lifecycle.webm`
covers delayed deterministic Ask/Teaching requests, parent rerender while
THINK is active, completion, rejection, and true unmount cancellation. The
recordings are produced by Chrome `MediaRecorder` from the captured UI stream,
not by a text trace or a test-only state setter. Reduced-motion is emulated by
the browser and includes a final concept screenshot. No credentials, network
services, DOM dumps, or learner data are written to the artifacts.

The run completed with exit code `0` and recorded these checkpoints in
`r148-trace.json`:

| Checkpoint | Evidence |
| --- | --- |
| V1 动效 — PASS | `episode-normal.webm`, `lumi-lifecycle.webm`; normal-mode UI recording covers idle, delayed THINK, parent rerender, target-step movement, valid feedback, and recovery. `normal-06-recovered.png` is the final recovery checkpoint. |
| V2 请求 — PASS | `lumi-lifecycle.webm`; the fixed browser run is the executable mounted-component check. `npm run check:lumi-mounted-lifecycle` is retained as a static wiring assertion only; `npm run test:teaching:integration` and the browser trace record Ask/Teaching start, busy, success/error, finish, and cancellation without duplicate provider calls. |
| V3 竞争 — PASS | `lumi-lifecycle.webm`; the fixed browser run executes natural expiry, Teaching Stop, reset, context-switch cancellation, and resolution of canceled pending fixtures; stale completions do not change the trace or presentation. The real panels suppress overlapping submissions, so no artificial A/B overlap is claimed. Deterministic checks cover timeout, stop, reset/context invalidation, rejection, and unmount cancellation. |
| V4 目标 — PASS | `episode-normal.webm`; `npm run check:lumi-visible-guidance`; the production Episode registers `model.fit`, `world.sample`, and `experiment.compare` targets and withdraws unavailable/stale targets. `normal-02-fit-a.png` through `normal-05-concept.png` show the real controls. |
| V5 课程 — PASS | `episode-normal.webm`; `npm run check:episode-1`; real UI sequence is entry → optional prediction skip → Fit A → same-World sample → Fit B → Compare → deterministic evidence → concept/continuations. |
| V6 反馈 — PASS | `episode-normal.webm`, `normal-05-concept.png`, `normal-06-recovered.png`; `npm run check:lumi-visible-guidance`; ordinary completion stays neutral, while the deterministic concept event illuminates once and returns to the appropriate state. |
| V7 仲裁 — PASS | `npm run check:lumi-visible-guidance`, `npm run check:lumi-embodied`, `npm run test:teaching:integration`; cooldown, stop, dismissal, stale requests, and competing THINK/feedback precedence are asserted. |
| V8 可访问性 — PASS | Fixed command reports Chinese narrow `390x844`, no horizontal overflow, keyboard focus, and English+Chinese parallel labels; evidence: `zh-narrow.png`, `parallel-entry.png`, reduced-motion `reduced-06-recovered.png`. |
| V9 权限回归 — PASS | `npm run check:lumi-visible-guidance`, `npm run check:episode-1`, `npm run check`; Cloud is off for the browser run, and presentation/debug controls remain detached from semantic World/Experiment/Evidence state. |
| V10 工程 — PASS | `npm run check`, `npm run build`, the static `npm run check:lumi-mounted-lifecycle` wiring check, fixed browser command, and `git diff --check` all pass on the current worktree. |

All PNGs are bounded to the 1280×720 viewport except the explicitly labelled
390×844 Chinese narrow check. The current artifact sizes are:

```text
normal-01-entry.png       67754 bytes
normal-02-fit-a.png       85464 bytes
normal-03-resample.png    70147 bytes
normal-04-fit-b.png       76147 bytes
normal-05-concept.png     71473 bytes
normal-06-recovered.png   69003 bytes
reduced-01-entry.png      67726 bytes
reduced-02-fit-a.png      85968 bytes
reduced-03-resample.png   70251 bytes
reduced-04-fit-b.png      72256 bytes
reduced-05-concept.png    69003 bytes
reduced-06-recovered.png  69003 bytes
zh-narrow.png             56286 bytes
parallel-entry.png        129156 bytes
mounted-lifecycle.png     88582 bytes
episode-normal.webm       170166 bytes (WebM/VP8)
lumi-lifecycle.webm       846180 bytes (WebM/VP8)
```

The fixed run's detailed semantic result is in `r148-trace.json`. Remote PR or
CI artifact hosting is not configured in this workspace, so these paths are
local review artifacts; Dev can rerun the command verbatim to regenerate them.
No commit, push, or PR update was made during this acceptance pass.
