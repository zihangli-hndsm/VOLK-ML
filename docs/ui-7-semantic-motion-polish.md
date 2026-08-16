# UI-7 — Semantic Motion & Product Polish

UI-7 adds a small presentation layer over the accepted Explore semantics. It
does not create a second runtime, alter World/Experiment state, or make an
animation a prerequisite for an action.

## Motion contract

`src/components/playground/motion.js` is the shared motion contract:

- `fast`: 120 ms for immediate control feedback;
- `normal`: 220 ms for depth, surface, and comparison reveals;
- `emphasis`: 320 ms for primitive/model-response transitions;
- semantic easing names are centralized alongside the tokens.

The existing primitive interpolation system continues to interpolate only
already-valid runtime snapshot primitives. The final frame is the exact new
runtime snapshot. The phenomenon workspace uses the normal token for model
primitives while leaving directly manipulated scatter points on the current
frame so pointer interaction stays responsive.

## Reduced motion

`REDUCED_MOTION_QUERY` and the CSS variables in `src/index.css` provide one
reduced-motion seam. `prefers-reduced-motion: reduce` changes durations to
zero, removes entrance animation, and disables smooth scrolling. Semantic
state, focus, and actions remain available without spatial motion.

## Semantic transitions

- A → B branch entry begins only after the committed experiment ID set changes;
  the newly-created runtime ID owns the entry motion even if the learner
  switches active experiments during the emphasis window;
- Compare details render only after the runtime comparison and diff exist;
- Changed, Held constant, and clarity use small staged reveals;
- Evidence/Mechanism/Inspector overlays use the same bounded presentation
  transition and remain mutually exclusive;
- opening a depth focuses its close control and closing returns focus to the
  originating depth button;
- Agent uses the same overlay transition and yields to the destination surface;
  normal Agent close returns focus to its trigger, while an Agent-to-depth
  handoff leaves focus inside the destination panel.

No `animationend`/`transitionend` callback dispatches a semantic operation,
and no telemetry is emitted for animation start or completion.

## Performance and remaining debt

High-frequency paths use explicit transition properties; there is no new
`transition: all` or cosmetic requestAnimationFrame loop. Existing primitive
interpolation is isolated to JSON snapshot props and is cancelled/restarted
when the semantic target changes. Build remains outside UI-7's scope.

The fitted-line transition is intentionally renderer-driven rather than a
React-side regression calculation. Larger visual redesigns, richer comparison
motion, and domain-specific motion remain deferred.

UI-7 is not marked complete in the authoritative roadmap until this draft has
passed final acceptance.
