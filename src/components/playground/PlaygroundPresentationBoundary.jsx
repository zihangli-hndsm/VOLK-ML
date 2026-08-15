import { useMemo } from 'react';
import {
  CONCEPTUAL_DEPTHS,
  UI_SURFACES,
  deriveUiPresentation,
} from '../../core/ui/uiArchitecture.js';

// Presentation-only seam. The runtime snapshot remains the single semantic
// state object; this wrapper only exposes stable surface metadata to future
// layout work without changing the current visual shell.
export default function PlaygroundPresentationBoundary({
  snapshot,
  children,
  surface = UI_SURFACES.EXPLORE,
  depth = CONCEPTUAL_DEPTHS.PHENOMENON,
  rawCapabilities,
  resolvedPresentation,
}) {
  const presentation = useMemo(
    () => deriveUiPresentation({ snapshot, surface, depth, rawCapabilities, resolvedPresentation }),
    [snapshot, surface, depth, rawCapabilities, resolvedPresentation],
  );
  return <div
    data-ui-surface={presentation.surface}
    data-ui-depth={presentation.depth}
    data-ui-presentation-band={presentation.responsive.band}
  >{children}</div>;
}
