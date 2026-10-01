# LUMI context-bubble placement

`LumiCompanion` now measures the rendered avatar image and context prompt and
places the prompt inside the current visual viewport without intersecting the
image. It prefers the avatar's upper edge, tries safe side/below positions near
viewport boundaries, and constrains prompt height when only a smaller safe area
is available. The prompt remains hidden until the first measurement completes.
Window and `visualViewport` resize/scroll events plus a `ResizeObserver` rerun
the calculation. Natural expiry, dismiss, and the `role="status"` announcement
remain in place; dismissal is pointer-accessible.

## Checks

```powershell
node scripts/check-lumi-context-bubble.mjs
npm run test:lumi-context-bubble:browser
```

The browser test mounts the real `LumiCompanion` with the product stylesheet,
disables Cloud, and checks 1280×720, 390×844, 1280×300, and 320×240. It asserts
loaded avatar pixels, prompt visibility, non-overlap, prompt containment in the
visual viewport, no document overflow beyond the CSS layout viewport, and a
working pointer dismissal. Existing mounted-lifecycle coverage checks natural
expiry. Layout, visual, and document-client widths are recorded separately;
the 1280px desktop case reports its 15px scrollbar delta, and 390px reports
the 17px emulator scrollbar delta. The compact 320×240 emulation applies a
0.786 visual scale; its physical viewport and CSS layout dimensions are both
kept in the trace rather than treated as interchangeable.

Native browser zoom is not verified: the available headless CDP page-scale
control simulates pinch scaling, not desktop browser zoom. Actual viewport
resizing is covered by the matrix.

## Evidence

The final focused run is in
[`lumi-context-bubble-trace.json`](assets/lumi-context-bubble-20261002-final/lumi-context-bubble-trace.json)
with screenshots for each viewport beside it. The trace records placement IDs,
avatar/prompt rectangles, visibility, overlap results, accessibility role and
dismiss label, viewport metrics, and overflow checks.
