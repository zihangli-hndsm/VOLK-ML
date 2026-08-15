import { useMemo } from 'react';
import {
  CONCEPTUAL_DEPTHS,
  UI_SURFACES,
  deriveUiPresentation,
} from '../../core/ui/uiArchitecture.js';
import {
  PresentationCapabilitiesProvider,
  useMeasuredPresentationCapabilities,
} from './usePresentationCapabilities.jsx';

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
  className = '',
}) {
  const measured = useMeasuredPresentationCapabilities({ rawCapabilities });
  const presentation = useMemo(
    () => deriveUiPresentation({ snapshot, surface, depth, resolvedPresentation: resolvedPresentation ?? measured.responsive }),
    [snapshot, surface, depth, resolvedPresentation, measured.responsive],
  );
  const value = useMemo(() => ({
    rawCapabilities: measured.rawCapabilities,
    responsive: presentation.responsive,
  }), [measured.rawCapabilities, presentation.responsive]);
  return <PresentationCapabilitiesProvider value={value}>
    <div
      ref={measured.containerRef}
      data-ui-surface={presentation.surface}
      data-ui-depth={presentation.depth}
      data-ui-presentation-band={presentation.responsive.band}
      data-ui-pointer={presentation.responsive.pointer}
      className={className}
    >{children}</div>
  </PresentationCapabilitiesProvider>;
}
