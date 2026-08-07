import { createBindingContext, resolveValue } from './bindings.js';
import { validatePrimitive } from './primitives.js';

// The Primitive Materializer is the only place where Visualization Script
// declarations become renderer props. It binds:
//
//   script.primitives (declaration + layout)
//   semantic state    ($model.*)
//   dataset context   ($data.*)
//   controls          ($controls.*)
//   trace             ($trace)
//   metrics           ($metrics.*)
//   visualState       (show/hide/highlight/annotation)
//
// A primitive exists in the output only if the script declares it; hiding via
// visualState removes it from the output. Scripts own composition.
export function materializePrimitives({
  script,
  semanticState,
  traces,
  controls,
  metrics,
  visualState,
  dataState,
}) {
  if (!script || !Array.isArray(script.primitives)) return [];
  const context = createBindingContext({
    model: semanticState ?? {},
    data: dataState ?? {},
    controls: controls ?? {},
    trace: traces ?? [],
    metrics: metrics ?? {},
  });
  return script.primitives
    .filter((declaration) => visualState?.[declaration.id] !== false)
    .map((declaration) => {
      const primitive = {
        id: declaration.id,
        type: declaration.type,
        props: resolveValue(declaration.props ?? {}, context),
      };
      validatePrimitive(primitive);
      return primitive;
    });
}
